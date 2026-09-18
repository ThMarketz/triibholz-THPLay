/* ============================================================
   help.js — "How to use" for every function.
   HELP.show('topic') opens a step-by-step guide; a ？ button in
   the topbar opens the guide for whatever view is on screen, and
   small ？ chips sit next to each feature. Content is coach-first:
   numbered steps, then tips.
   ============================================================ */
const HELP = (() => {
  /* TOPICS below holds KEY NAMES, not prose. The object is built once when this file
     loads, so any text baked into it would freeze whatever language the app booted in.
     The English lives in js/i18n.js with the other 3 languages, and show() resolves a
     key at render time. */
  const TH = k => (typeof I18N !== 'undefined') ? I18N.t(k) : k;

  const TOPICS = {
    dashboard: { icon:'🏠', title:'help.dashboard.title', steps:[
      'help.dashboard.s1',
      'help.dashboard.s2',
      'help.dashboard.s3',
      'help.dashboard.s4',
    ], tips:[ 'help.dashboard.t1', 'help.dashboard.t6', 'help.dashboard.t2', 'help.dashboard.t3', 'help.dashboard.t4', 'help.dashboard.t5' ]},

    playbook: { icon:'📖', title:'help.playbook.title', steps:[
      'help.playbook.s1',
      'help.playbook.s2',
      'help.playbook.s3',
      'help.playbook.s4',
      'help.playbook.s5',
      'help.playbook.s6',
    ], tips:[
      'help.playbook.t1',
      'help.playbook.t2',
    ]},

    adjust: { icon:'✋', title:'help.adjust.title', steps:[
      'help.adjust.s1',
      'help.adjust.s2',
      'help.adjust.s3',
      'help.adjust.s4',
      'help.adjust.s5',
    ], tips:[
      'help.adjust.t1',
      'help.adjust.t2',
    ]},

    editor: { icon:'✏️', title:'help.editor.title', steps:[
      'help.editor.s1',
      'help.editor.s2',
      'help.editor.s3',
      'help.editor.s4',
      'help.editor.s5',
      'help.editor.s6',
    ], tips:[ 'help.editor.t1' ]},

    solutions: { icon:'💡', title:'help.solutions.title', steps:[
      'help.solutions.s1',
      'help.solutions.s2',
      'help.solutions.s3',
      'help.solutions.s4',
    ], tips:[
      'help.solutions.t1',
      'help.solutions.t2',
    ]},

    autoscout: { icon:'🧠', title:'help.autoscout.title', steps:[
      'help.autoscout.s1',
      'help.autoscout.s2',
      'help.autoscout.s3',
      'help.autoscout.s4',
      'help.autoscout.s5',
    ], tips:[
      'help.autoscout.t1',
      'help.autoscout.t2',
    ]},

    gameplan: { icon:'🎯', title:'help.gameplan.title', steps:[
      'help.gameplan.s1',
      'help.gameplan.s2',
      'help.gameplan.s3',
      'help.gameplan.s4',
    ], tips:[
      'help.gameplan.t1',
      'help.gameplan.t2',
    ]},

    share: { icon:'📤', title:'help.share.title', steps:[
      'help.share.s1',
      'help.share.s2',
      'help.share.s3',
      'help.share.s4',
    ], tips:[
      'help.share.t1',
      'help.share.t2',
    ]},

    shooting: { icon:'🎯', title:'help.shooting.title', steps:[
      'help.shooting.s1',
      'help.shooting.s2',
      'help.shooting.s3',
      'help.shooting.s4',
      'help.shooting.s5',
    ], tips:[
      'help.shooting.t1',
      'help.shooting.t2',
    ]},

    scene3d: { icon:'🎥', title:'help.scene3d.title', steps:[
      'help.scene3d.s1',
      'help.scene3d.s2',
      'help.scene3d.s3',
      'help.scene3d.s4',
    ], tips:[
      'help.scene3d.t1',
      'help.scene3d.t2',
    ]},

    development: { icon:'📈', title:'help.development.title', steps:[
      'help.development.s1',
      'help.development.s2',
      'help.development.s3',
      'help.development.s4',
      'help.development.s5',
      'help.development.s6',
      'help.development.s7',
      'help.development.s8',
    ], tips:[
      'help.development.t1',
      'help.development.t2',
      'help.development.t3',
    ]},

    announcements: { icon:'📣', title:'help.announcements.title', steps:[
      'help.announcements.s1',
      'help.announcements.s2',
      'help.announcements.s3',
      'help.announcements.s4',
    ], tips:[
      'help.announcements.t1',
      'help.announcements.t2',
    ]},

    privacy: { icon:'🔒', title:'help.privacy.title', steps:[
      'help.privacy.s1',
      'help.privacy.s2',
      'help.privacy.s3',
    ], tips:[
      'help.privacy.t1',
      'help.privacy.t2',
    ]},

    season: { icon:'📅', title:'help.season.title', steps:[
      'help.season.s1',
      'help.season.s2',
      'help.season.s3',
      'help.season.s4',
      'help.season.s5',
      'help.season.s6',
      'help.season.s7',
    ], tips:[
      'help.season.t1',
      'help.season.t2',
    ]},

    video: { icon:'🎬', title:'help.video.title', steps:[
      'help.video.s1',
      'help.video.s2',
      'help.video.s3',
      'help.video.s4',
    ], tips:[
      'help.video.t1',
      'help.video.t2',
    ]},

    commands: { icon:'⚡', title:'help.commands.title', steps:[
      'help.commands.s1',
      'help.commands.s2',
      'help.commands.s3',
      'help.commands.s4',
      'help.commands.s5',
      'help.commands.s6',
    ], tips:[
      'help.commands.t1',
      'help.commands.t2',
    ]},

    film: { icon:'🎬', title:'help.film.title', steps:[
      'help.film.s1',
      'help.film.s2',
      'help.film.s3',
      'help.film.s4',
      'help.film.s5',
      'help.film.s6',
      'help.film.s7',
      'help.film.sCut',
      'help.film.s8',
      'help.film.s9',
      'help.film.s10',
    ], tips:[ 'help.film.t1', 'help.film.t2' ]},

    trivia: { icon:'🎓', title:'help.trivia.title', steps:[
      'help.trivia.s1',
      'help.trivia.s2',
      'help.trivia.s3',
    ], tips:[ 'help.trivia.t1' ]},

    basics: { icon:'📘', title:'help.basics.title', steps:[
      'help.basics.s1',
      'help.basics.s2',
      'help.basics.s3',
    ]},

    admin: { icon:'🛡️', title:'help.admin.title', steps:[
      'help.admin.s1',
      'help.admin.s2',
      'help.admin.s3',
    ]},
  };

  const VIEW_TOPIC = { dashboard:'dashboard', playbook:'playbook', basics:'basics', film:'film', solutions:'solutions', trivia:'trivia', admin:'admin' };

  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop help-backdrop';
    modal.hidden = true;
    modal.innerHTML = `<div class="modal help-modal">
      <div class="modal-head"><h3 id="help-title">${TH('help.modalTitle')}</h3><button class="modal-x" id="help-x">✕</button></div>
      <div class="modal-body" id="help-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#help-x').onclick = hide;
    modal.addEventListener('click', e => { if (e.target === modal) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) hide(); });
    return modal;
  }

  function show(topicId) {
    const t = TOPICS[topicId] || TOPICS.playbook;
    const m = ensureModal();
    m.querySelector('#help-title').innerHTML = `${t.icon} ${TH(t.title)}`;
    m.querySelector('#help-body').innerHTML =
      `<ol class="help-steps">${t.steps.map(s=>`<li>${TH(s)}</li>`).join('')}</ol>` +
      (t.tips && t.tips.length ? `<div class="help-tips">${t.tips.map(x=>`<div class="help-tip">💡 ${TH(x)}</div>`).join('')}</div>` : '');
    m.hidden = false;
  }
  function hide() { if (modal) modal.hidden = true; }
  function forView(view) { show(VIEW_TOPIC[view] || 'playbook'); }

  return { show, hide, forView, TOPICS };
})();
