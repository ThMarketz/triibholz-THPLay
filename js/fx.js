/* ============================================================
   fx.js — the playful layer: Polo the mascot, confetti goal
   celebrations, and opt-in sound (WebAudio, no audio files).
   All effects are safe no-ops when unsupported.
   ============================================================ */
const FX = (() => {
  const SKEY = 'thplay.sound';
  let soundOn = false;
  try { soundOn = localStorage.getItem(SKEY) === '1'; } catch(e){}

  function setSound(on){ soundOn = !!on; try { localStorage.setItem(SKEY, on?'1':'0'); } catch(e){} }
  function isSoundOn(){ return soundOn; }

  let AC = null;
  function ctx(){
    if (AC) return AC;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ AC = null; }
    return AC;
  }
  // tiny synthesised blips — name: 'whistle' | 'pop' | 'win' | 'tick'
  function sound(name){
    if (!soundOn) return;
    const ac = ctx(); if (!ac) return;
    try { if (ac.state === 'suspended') ac.resume(); } catch(e){}
    const now = ac.currentTime;
    const beep = (freq, start, dur, type='sine', vol=0.15) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, now+start);
      g.gain.setValueAtTime(0.0001, now+start);
      g.gain.exponentialRampToValueAtTime(vol, now+start+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now+start+dur);
      o.connect(g); g.connect(ac.destination); o.start(now+start); o.stop(now+start+dur+0.02);
    };
    if (name==='whistle'){ beep(2100,0,0.18,'square',0.12); beep(2500,0.06,0.16,'square',0.1); }
    else if (name==='pop'){ beep(440,0,0.08,'triangle',0.12); }
    else if (name==='tick'){ beep(880,0,0.04,'sine',0.08); }
    else if (name==='win'){ [523,659,784,1047].forEach((f,i)=>beep(f,i*0.09,0.16,'triangle',0.14)); }
  }

  // confetti + splash burst
  function confetti(count){
    if (typeof document==='undefined') return;
    count = count || 90;
    const wrap = document.createElement('div'); wrap.className='fx-confetti';
    document.body.appendChild(wrap);
    const cols = ['#ff7a18','#16b3c4','#2bd07a','#ffd400','#ffffff','#e23b3b'];
    const W = window.innerWidth || 360;
    for (let i=0;i<count;i++){
      const s = document.createElement('span');
      const x = Math.random()*W;
      const delay = Math.random()*0.25;
      const dur = 1 + Math.random()*0.9;
      const size = 6 + Math.random()*7;
      s.style.cssText = `left:${x}px;top:-16px;width:${size}px;height:${size*0.6}px;`+
        `background:${cols[i%cols.length]};animation-delay:${delay}s;animation-duration:${dur}s;`+
        `transform:rotate(${Math.random()*360}deg)`;
      wrap.appendChild(s);
    }
    setTimeout(()=>wrap.remove(), 2400);
  }

  // full celebration: confetti + sound + a short centred banner
  function celebrate(title, sub){
    confetti();
    sound('win');
    if (typeof document==='undefined') return;
    const b = document.createElement('div'); b.className='fx-banner';
    b.innerHTML = `<div class="fx-banner-card">${mascot(46)}<div><strong>${title||'Goal!'}</strong>${sub?`<span>${sub}</span>`:''}</div></div>`;
    document.body.appendChild(b);
    requestAnimationFrame(()=> b.classList.add('show'));
    setTimeout(()=>{ b.classList.remove('show'); setTimeout(()=>b.remove(),300); }, 1700);
  }

  // Polo — the water-polo-ball mascot
  function mascot(size){
    size = size || 40;
    return `<svg class="mascot" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="25" r="20" fill="#ff7a18" stroke="#9c3d00" stroke-width="2"/>
      <path d="M6 22 q18 -12 36 0 M6 30 q18 12 36 0 M24 5 v40" stroke="#fff" stroke-width="1.4" fill="none" opacity=".85"/>
      <circle cx="17" cy="21" r="4.4" fill="#fff"/><circle cx="31" cy="21" r="4.4" fill="#fff"/>
      <circle cx="18" cy="22" r="2.1" fill="#0b1f2c"/><circle cx="32" cy="22" r="2.1" fill="#0b1f2c"/>
      <path d="M17 31 q7 6 14 0" stroke="#0b1f2c" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  return { setSound, isSoundOn, sound, confetti, celebrate, mascot };
})();
