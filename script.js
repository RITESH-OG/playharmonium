(() => {
  "use strict";

  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const SWAR = ["Sa","Re","Ga","Ma","Pa","Dha","Ni"];
  // 16 white keys, starting at C3.
  const whiteNotes = [
    {midi:48,key:"a"},{midi:50,key:"s"},{midi:52,key:"d"},{midi:53,key:"f"},
    {midi:55,key:"g"},{midi:57,key:"h"},{midi:59,key:"j"},{midi:60,key:"k"},
    {midi:62,key:"l"},{midi:64,key:";"},{midi:65,key:"'"},{midi:67,key:"z"},
    {midi:69,key:"x"},{midi:71,key:"c"},{midi:72,key:"v"},{midi:74,key:"b"}
  ];
  const blackNotes = [
    {midi:49,key:"q",after:0},{midi:51,key:"w",after:1},
    {midi:54,key:"e",after:3},{midi:56,key:"r",after:4},
    {midi:58,key:"t",after:5},{midi:61,key:"y",after:7},
    {midi:63,key:"u",after:8},{midi:66,key:"i",after:9},
    {midi:68,key:"o",after:10},{midi:70,key:"p",after:12},
    {midi:73,key:"[",after:13},{midi:75,key:"]",after:14}
  ];

  let audioCtx = null;
  let masterGain = null;
  let convolver = null;
  let reverbGain = null;
  const active = new Map();
  const SAMPLE_ROOTS = {
    sa: 109.8, re: 123.3, ga: 130.6, ma: 146.6,
    pa: 164.6, dha: 175.4, ni: 196.8
  };
  const SAMPLE_FILES = Object.keys(SAMPLE_ROOTS).map(name => ({
    name, file: `sounds/${name}.wav`, root: SAMPLE_ROOTS[name]
  }));
  const sampleBuffers = {};
  let samplesLoading = null;
  let transpose = 0;
  let octaveShift = 0;
  let reeds = 0;
  let volume = 0.72;
  let recording = false;
  let mediaRecorder = null;
  let chunks = [];
  let recordingDestination = null;
  let attack = 0.055;
  let release = 0.55;

  const keyboard = document.getElementById("keyboard");
  const toast = document.getElementById("toast");

  function midiToFreq(midi){ return 440 * Math.pow(2,(midi-69)/12); }

  async function loadHarmoniumSamples(){
    if(samplesLoading) return samplesLoading;
    samplesLoading = (async()=>{
      ensureAudio();
      await Promise.all(SAMPLE_FILES.map(async item=>{
        try{
          const res = await fetch(item.file, {cache:"force-cache"});
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.arrayBuffer();
          sampleBuffers[item.name] = await audioCtx.decodeAudioData(data);
        }catch(err){
          console.warn("Sample unavailable:", item.file, err);
        }
      }));
    })();
    return samplesLoading;
  }

  function swarForMidi(midi){
    // C-major / shuddha-swar mapping used by the visible key labels.
    return ["sa","re","ga","ma","pa","dha","ni"][((midi % 12)+12)%12 % 7];
  }

  function ensureAudio(){
    if(audioCtx) {
      if(audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;

    convolver = audioCtx.createConvolver();
    const len = Math.floor(audioCtx.sampleRate * 1.25);
    const impulse = audioCtx.createBuffer(2,len,audioCtx.sampleRate);
    for(let c=0;c<2;c++){
      const data = impulse.getChannelData(c);
      for(let i=0;i<len;i++){
        data[i] = (Math.random()*2-1) * Math.pow(1-i/len,2.6);
      }
    }
    convolver.buffer = impulse;
    reverbGain = audioCtx.createGain();
    reverbGain.gain.value = document.getElementById("reverbToggle").checked ? 0.12 : 0;

    const dry = audioCtx.createGain();
    dry.gain.value = 1;
    masterGain.connect(dry).connect(audioCtx.destination);
    masterGain.connect(convolver).connect(reverbGain).connect(audioCtx.destination);

    try{
      recordingDestination = audioCtx.createMediaStreamDestination();
      masterGain.connect(recordingDestination);
    }catch(e){ recordingDestination = null; }
  }

  function makeKeyElements(){
    keyboard.innerHTML = "";
    whiteNotes.forEach((n,i)=>{
      const el = document.createElement("button");
      el.className = "key white";
      el.dataset.midi = n.midi;
      el.dataset.key = n.key;
      const swar = SWAR[i % 7] + (i >= 7 ? "’" : "");
      el.innerHTML = `<span class="key-label"><span>${swar}</span><small>${n.key}</small></span>`;
      bindKey(el);
      keyboard.appendChild(el);
    });
    blackNotes.forEach(n=>{
      const el = document.createElement("button");
      el.className = "key black";
      el.dataset.midi = n.midi;
      el.dataset.key = n.key;
      el.style.left = `${((n.after + 1) / whiteNotes.length) * 100}%`;
      el.innerHTML = `<span class="key-label"><small>${n.key}</small></span>`;
      bindKey(el);
      keyboard.appendChild(el);
    });
  }

  function bindKey(el){
    const start = e => {
      e.preventDefault();
      ensureAudio();
      el.setPointerCapture?.(e.pointerId);
      noteOn(el.dataset.key, Number(el.dataset.midi), el);
    };
    const end = e => {
      e.preventDefault();
      noteOff(el.dataset.key, el);
    };
    el.addEventListener("pointerdown",start);
    el.addEventListener("pointerup",end);
    el.addEventListener("pointercancel",end);
    el.addEventListener("pointerleave",e=>{
      if(e.buttons) noteOff(el.dataset.key,el);
    });
  }

  // Reference-recording-based harmonium voice.
  // Each swar uses a short sample extracted from the supplied recording.
  // Web Audio changes playbackRate so every key gets the correct pitch.
  function createVoice(freq, swar){
    const now = audioCtx.currentTime;
    const output = audioCtx.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.linearRampToValueAtTime(0.72, now + Math.max(0.035, attack));
    output.connect(masterGain);

    const buffer = sampleBuffers[swar];
    if(buffer){
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const root = SAMPLE_ROOTS[swar];
      source.playbackRate.value = Math.max(0.25, Math.min(4, freq/root));
      source.loop = true;
      source.loopStart = Math.min(0.13, buffer.duration*0.22);
      source.loopEnd = Math.max(source.loopStart+0.05, buffer.duration-0.035);

      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 4200;
      filter.Q.value = 0.25;

      source.connect(filter).connect(output);
      source.start(now);

      return {oscillators:[], output, source, sample:true};
    }

    // Local fallback if the WAV sample bank cannot be loaded.
    const tone = audioCtx.createBiquadFilter();
    tone.type="lowpass"; tone.frequency.value=3600; tone.Q.value=.35;
    tone.connect(output);
    const parts=[
      ["sine",1,.40],["triangle",1,.18],["sine",2,.18],
      ["sine",3,.105],["triangle",4,.065],["sine",5,.035]
    ];
    if(reeds>=1)parts.push(["sawtooth",1.0015,.055]);
    if(reeds>=2)parts.push(["sawtooth",2.003,.035]);
    if(reeds>=3)parts.push(["triangle",6,.028]);
    const oscillators=[];
    parts.forEach(([type,mult,gainAmount])=>{
      const osc=audioCtx.createOscillator(),g=audioCtx.createGain();
      osc.type=type;osc.frequency.value=freq*mult;g.gain.value=gainAmount;
      osc.connect(g).connect(tone);osc.start(now);oscillators.push(osc);
    });
    return {oscillators,output,sample:false};
  }

  function noteOn(key,midi,el){
    if(active.has(key)) return;
    const shiftedMidi = midi + transpose + octaveShift*12;
    const freq = midiToFreq(shiftedMidi);
    const swar = swarForMidi(midi);
    const voice = createVoice(freq, swar);
    active.set(key,{...voice,el,midi:shiftedMidi});
    el.classList.add("active");

    // Load the reference samples after the first interaction if needed.
    if(Object.keys(sampleBuffers).length === 0) loadHarmoniumSamples();
  }

  function noteOff(key,el){
    const v=active.get(key);
    if(!v) return;
    const now=audioCtx.currentTime;

    v.output.gain.cancelScheduledValues(now);
    v.output.gain.setTargetAtTime(0.0001, now, Math.max(0.08, release/3));

    v.oscillators.forEach(o=>{
      try{o.stop(now + release + 0.08)}catch(_){}
    });
    if(v.source){
      try{v.source.stop(now + release + 0.08)}catch(_){}
    }
    if(v.lfo){try{v.lfo.stop(now + release + 0.08)}catch(_){}}
    if(v.noise){try{v.noise.stop(now + 0.12)}catch(_){}}

    active.delete(key);
    el.classList.remove("active");
  }

  function stopAll(){
    [...active.entries()].forEach(([k,v])=>noteOff(k,v.el));
  }

  function getEl(key){
    return [...document.querySelectorAll(".key")].find(x=>x.dataset.key===key);
  }

  function updateLabels(){
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    document.getElementById("transposeValue").textContent = names[(transpose%12+12)%12];
    document.getElementById("octaveValue").textContent = String(3+octaveShift);
    document.getElementById("reedValue").textContent = String(reeds);
  }

  function toastMsg(msg){
    toast.textContent=msg;toast.classList.add("show");
    clearTimeout(toastMsg.t);toastMsg.t=setTimeout(()=>toast.classList.remove("show"),1900);
  }

  function changeTranspose(delta){
    transpose=Math.max(-12,Math.min(12,transpose+delta)); updateLabels();
    toastMsg(`Transpose: ${document.getElementById("transposeValue").textContent}`);
  }
  function changeOctave(delta){
    octaveShift=Math.max(-2,Math.min(3,octaveShift+delta)); updateLabels();
    toastMsg(`Octave: ${3+octaveShift}`);
  }
  function changeReeds(delta){
    reeds=Math.max(0,Math.min(3,reeds+delta)); updateLabels();
    toastMsg(`Reeds: ${reeds}`);
  }

  document.querySelectorAll("[data-action]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const a=btn.dataset.action;
      if(a==="transposeDown")changeTranspose(-1);
      if(a==="transposeUp")changeTranspose(1);
      if(a==="octaveDown")changeOctave(-1);
      if(a==="octaveUp")changeOctave(1);
      if(a==="reedDown")changeReeds(-1);
      if(a==="reedUp")changeReeds(1);
    });
  });

  document.getElementById("volume").addEventListener("input",e=>{
    volume=Number(e.target.value);
    if(masterGain) masterGain.gain.setTargetAtTime(volume,audioCtx.currentTime,.02);
  });

  document.getElementById("reverbToggle").addEventListener("change",e=>{
    ensureAudio();
    reverbGain.gain.setTargetAtTime(e.target.checked?.16:0,audioCtx.currentTime,.08);
  });

  function keyDown(e){
    if(e.repeat) return;
    if(e.code==="Space"){e.preventDefault();stopAll();return}
    if(e.key==="Tab"){
      e.preventDefault();
      const r=document.getElementById("reverbToggle");
      r.checked=!r.checked;r.dispatchEvent(new Event("change"));return;
    }
    if(e.key==="ArrowLeft"){e.preventDefault();changeTranspose(-1);return}
    if(e.key==="ArrowRight"){e.preventDefault();changeTranspose(1);return}
    if(e.key==="PageUp"){e.preventDefault();changeOctave(1);return}
    if(e.key==="PageDown"){e.preventDefault();changeOctave(-1);return}
    if(e.altKey && e.key==="ArrowLeft"){e.preventDefault();changeReeds(-1);return}
    if(e.altKey && e.key==="ArrowRight"){e.preventDefault();changeReeds(1);return}
    if(e.key==="ArrowUp"){e.preventDefault();volume=Math.min(1,volume+.05);document.getElementById("volume").value=volume;if(masterGain)masterGain.gain.value=volume;return}
    if(e.key==="ArrowDown"){e.preventDefault();volume=Math.max(0,volume-.05);document.getElementById("volume").value=volume;if(masterGain)masterGain.gain.value=volume;return}
    const key=e.key.toLowerCase();
    const el=getEl(key);
    if(el){ensureAudio();noteOn(key,Number(el.dataset.midi),el)}
  }
  function keyUp(e){
    const key=e.key.toLowerCase(),el=getEl(key);
    if(el) noteOff(key,el);
  }
  window.addEventListener("keydown",keyDown);
  window.addEventListener("keyup",keyUp);
  window.addEventListener("blur",stopAll);

  document.getElementById("themeBtn").addEventListener("click",()=>{
    document.body.classList.toggle("dark");
    toastMsg(document.body.classList.contains("dark")?"Dark mode":"Light mode");
  });

  const shortcutBar=document.getElementById("shortcuts");
  document.getElementById("shortcutToggle").addEventListener("click",()=>{
    const hidden=shortcutBar.classList.toggle("hidden");
    if(hidden){
      [...shortcutBar.children].forEach((x,i)=>{if(i<shortcutBar.children.length-1)x.style.display="none"});
      document.getElementById("shortcutToggle").style.display="block";
      document.getElementById("shortcutToggle").textContent="Show ↓";
    }else location.reload();
  });

  const settingsDialog=document.getElementById("settingsDialog");
  document.getElementById("settingsBtn").onclick=()=>settingsDialog.showModal();
  document.getElementById("settingsClose").onclick=()=>settingsDialog.close();
  document.getElementById("helpBtn").onclick=()=>document.getElementById("helpDialog").showModal();
  document.getElementById("helpClose").onclick=()=>document.getElementById("helpDialog").close();
  document.getElementById("appBtn").onclick=()=>toastMsg("Install this page from your browser's menu.");

  document.getElementById("attack").addEventListener("input",e=>attack=Number(e.target.value));
  document.getElementById("release").addEventListener("input",e=>release=Number(e.target.value));

  async function toggleRecording(){
    ensureAudio();
    const btn=document.getElementById("recordBtn");
    const text=document.getElementById("recordText");
    if(!recording){
      if(!recordingDestination || !window.MediaRecorder){
        toastMsg("Recording is not supported in this browser.");
        return;
      }
      chunks=[];
      try{
        mediaRecorder=new MediaRecorder(recordingDestination.stream);
        mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
        mediaRecorder.onstop=()=>{
          const blob=new Blob(chunks,{type:mediaRecorder.mimeType||"audio/webm"});
          const url=URL.createObjectURL(blob);
          const a=document.createElement("a");
          a.href=url;a.download=`raagsetu-recording-${Date.now()}.webm`;
          a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
          toastMsg("Recording downloaded.");
        };
        mediaRecorder.start();
        recording=true;text.textContent="Stop";
        btn.classList.add("recording");
        toastMsg("Recording started");
      }catch(err){toastMsg("Could not start recording.");}
    }else{
      mediaRecorder.stop();
      recording=false;text.textContent="Record";
      btn.classList.remove("recording");
    }
  }
  document.getElementById("recordBtn").onclick=toggleRecording;

  makeKeyElements();
  updateLabels();
})();
