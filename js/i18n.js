/* ============================================================
   i18n.js — tiny internationalisation runtime for Triibholz.
   t('key', {vars}) returns the translated string; apply(root)
   localises any element with data-i18n / data-i18n-ph / data-i18n-title.
   UI chrome is translated in EN/DE/FR/IT; tactical play content
   (play names, coaching notes) stays English-first for accuracy.
   ============================================================ */
const I18N = (() => {
  const KEY = 'thplay.lang';
  const SUPPORTED = [
    { code:'en', label:'English',  flag:'🇬🇧' },
    { code:'de', label:'Deutsch',  flag:'🇩🇪' },
    { code:'fr', label:'Français', flag:'🇫🇷' },
    { code:'it', label:'Italiano', flag:'🇮🇹' },
  ];

  const DICT = {
    en: {
      'app.tagline':'Strategies & movement patterns — for the team and for every position.',
      'auth.note':'Two sign-in methods, as requested. In this prototype both buttons run a simulated sign-in so you can use the app immediately — real Apple & Google connect when we deploy.',
      'auth.foot':'Designated access only · Coaches & Players',
      'auth.apple':'Sign in with Apple', 'auth.google':'Sign in with Google',
      'setup.welcome':'Welcome', 'setup.sub':'Tell us who you are so we can tailor the playbook.',
      'setup.iam':'I am a…', 'setup.posReq':'My position (required)', 'setup.posOpt':'My position (optional for coaches)',
      'setup.noteStaff':'Players & staff need a Super Admin to approve access before signing in.',
      'setup.noteAdmin':'Super Admins are provisioned directly and can approve everyone else.',
      'setup.request':'Request access', 'setup.enterAdmin':'Enter as Super Admin',
      'role.super-admin':'Super Admin','role.coach':'Coach','role.trainer':'Trainer','role.player':'Player',
      'pending.title':'Waiting for approval','pending.recheck':'Check again','pending.another':'Use another account',
      'pending.sub':'Approvals happen in the Super Admin console. You’ll be let in as soon as you’re approved.',
      'denied.title':'Access not granted','denied.another':'Use another account',
      'nav.dashboard':'Dashboard','nav.playbook':'Playbook','nav.basics':'Basics','nav.trivia':'Trivia','nav.admin':'Admin',
      'phase.offense':'Offense','phase.defense':'Defense',
      'mode.problem':'Problem','mode.solution':'Solution','mode.reveal':'Reveal solution ▶',
      'view.team':'Team','view.me':'My position','view.focus':'Focus…',
      'lib.title':'Scenarios','lib.new':'+ New','lib.pick':'Pick a situation above','lib.select':'Select a scenario',
      'assign.title':'Assignments','assign.hint':'What each position does',
      'basics.title':'Water polo basics','basics.sub':'The high-level fundamentals — then jump into the Playbook to see them in motion.',
      'basics.rulebooks':'Official rule books — Swiss Aquatics','basics.seePlaybook':'See it in the Playbook','basics.testTrivia':'Test yourself with Trivia',
      'trivia.title':'Water Polo Trivia','trivia.start':'Start quiz','trivia.again':'Try again','trivia.back':'Back to dashboard',
      'common.signout':'Sign out','common.save':'Save','common.cancel':'Cancel','common.edit':'Edit','common.lang':'Language',
      'demo.or':'or jump straight into the demo','demo.coach':'Coach demo','demo.player':'Player demo','demo.admin':'Admin demo',
    },
    de: {
      'app.tagline':'Strategien & Laufwege — fürs Team und für jede Position.',
      'auth.note':'Zwei Anmeldemethoden, wie gewünscht. In diesem Prototyp führen beide Buttons eine simulierte Anmeldung aus — echtes Apple & Google folgen beim Deployment.',
      'auth.foot':'Nur für berechtigte Personen · Trainer & Spieler',
      'auth.apple':'Mit Apple anmelden','auth.google':'Mit Google anmelden',
      'setup.welcome':'Willkommen','setup.sub':'Sag uns, wer du bist, damit wir das Playbook anpassen können.',
      'setup.iam':'Ich bin…','setup.posReq':'Meine Position (erforderlich)','setup.posOpt':'Meine Position (für Trainer optional)',
      'setup.noteStaff':'Spieler & Staff brauchen die Freigabe eines Super-Admins, bevor sie sich anmelden können.',
      'setup.noteAdmin':'Super-Admins werden direkt eingerichtet und können alle anderen freigeben.',
      'setup.request':'Zugang anfragen','setup.enterAdmin':'Als Super-Admin eintreten',
      'role.super-admin':'Super-Admin','role.coach':'Trainer','role.trainer':'Co-Trainer','role.player':'Spieler',
      'pending.title':'Warten auf Freigabe','pending.recheck':'Erneut prüfen','pending.another':'Anderes Konto verwenden',
      'pending.sub':'Freigaben erfolgen in der Super-Admin-Konsole. Du wirst sofort nach der Freigabe eingelassen.',
      'denied.title':'Zugang nicht erteilt','denied.another':'Anderes Konto verwenden',
      'nav.dashboard':'Übersicht','nav.playbook':'Playbook','nav.basics':'Grundlagen','nav.trivia':'Quiz','nav.admin':'Admin',
      'phase.offense':'Angriff','phase.defense':'Abwehr',
      'mode.problem':'Aufgabe','mode.solution':'Lösung','mode.reveal':'Lösung zeigen ▶',
      'view.team':'Team','view.me':'Meine Position','view.focus':'Fokus…',
      'lib.title':'Szenarien','lib.new':'+ Neu','lib.pick':'Wähle oben eine Situation','lib.select':'Szenario auswählen',
      'assign.title':'Aufgaben','assign.hint':'Was jede Position macht',
      'basics.title':'Wasserball-Grundlagen','basics.sub':'Die wichtigsten Grundlagen — dann ins Playbook, um sie in Bewegung zu sehen.',
      'basics.rulebooks':'Offizielle Reglemente — Swiss Aquatics','basics.seePlaybook':'Im Playbook ansehen','basics.testTrivia':'Im Quiz testen',
      'trivia.title':'Wasserball-Quiz','trivia.start':'Quiz starten','trivia.again':'Nochmal','trivia.back':'Zur Übersicht',
      'common.signout':'Abmelden','common.save':'Speichern','common.cancel':'Abbrechen','common.edit':'Bearbeiten','common.lang':'Sprache',
      'demo.or':'oder direkt in die Demo','demo.coach':'Trainer-Demo','demo.player':'Spieler-Demo','demo.admin':'Admin-Demo',
    },
    fr: {
      'app.tagline':'Stratégies & déplacements — pour l’équipe et pour chaque poste.',
      'auth.note':'Deux méthodes de connexion, comme demandé. Dans ce prototype, les deux boutons simulent la connexion — Apple & Google réels arriveront au déploiement.',
      'auth.foot':'Accès réservé · Entraîneurs & Joueurs',
      'auth.apple':'Se connecter avec Apple','auth.google':'Se connecter avec Google',
      'setup.welcome':'Bienvenue','setup.sub':'Dis-nous qui tu es pour personnaliser le playbook.',
      'setup.iam':'Je suis…','setup.posReq':'Mon poste (obligatoire)','setup.posOpt':'Mon poste (facultatif pour les entraîneurs)',
      'setup.noteStaff':'Les joueurs et le staff doivent être approuvés par un Super Admin avant de se connecter.',
      'setup.noteAdmin':'Les Super Admins sont créés directement et peuvent approuver tout le monde.',
      'setup.request':'Demander l’accès','setup.enterAdmin':'Entrer en Super Admin',
      'role.super-admin':'Super Admin','role.coach':'Entraîneur','role.trainer':'Préparateur','role.player':'Joueur',
      'pending.title':'En attente d’approbation','pending.recheck':'Vérifier à nouveau','pending.another':'Utiliser un autre compte',
      'pending.sub':'Les approbations se font dans la console Super Admin. Tu entreras dès que tu seras approuvé.',
      'denied.title':'Accès refusé','denied.another':'Utiliser un autre compte',
      'nav.dashboard':'Tableau de bord','nav.playbook':'Playbook','nav.basics':'Bases','nav.trivia':'Quiz','nav.admin':'Admin',
      'phase.offense':'Attaque','phase.defense':'Défense',
      'mode.problem':'Problème','mode.solution':'Solution','mode.reveal':'Voir la solution ▶',
      'view.team':'Équipe','view.me':'Mon poste','view.focus':'Focus…',
      'lib.title':'Scénarios','lib.new':'+ Nouveau','lib.pick':'Choisis une situation ci-dessus','lib.select':'Sélectionne un scénario',
      'assign.title':'Consignes','assign.hint':'Ce que fait chaque poste',
      'basics.title':'Bases du water-polo','basics.sub':'Les fondamentaux — puis le Playbook pour les voir en mouvement.',
      'basics.rulebooks':'Règlements officiels — Swiss Aquatics','basics.seePlaybook':'Voir dans le Playbook','basics.testTrivia':'Teste-toi au Quiz',
      'trivia.title':'Quiz Water-Polo','trivia.start':'Commencer','trivia.again':'Recommencer','trivia.back':'Au tableau de bord',
      'common.signout':'Se déconnecter','common.save':'Enregistrer','common.cancel':'Annuler','common.edit':'Modifier','common.lang':'Langue',
      'demo.or':'ou accède directement à la démo','demo.coach':'Démo entraîneur','demo.player':'Démo joueur','demo.admin':'Démo admin',
    },
    it: {
      'app.tagline':'Strategie & movimenti — per la squadra e per ogni ruolo.',
      'auth.note':'Due metodi di accesso, come richiesto. In questo prototipo entrambi i pulsanti simulano l’accesso — Apple e Google reali al rilascio.',
      'auth.foot':'Accesso riservato · Allenatori & Giocatori',
      'auth.apple':'Accedi con Apple','auth.google':'Accedi con Google',
      'setup.welcome':'Benvenuto','setup.sub':'Dicci chi sei per personalizzare il playbook.',
      'setup.iam':'Sono un…','setup.posReq':'Il mio ruolo (obbligatorio)','setup.posOpt':'Il mio ruolo (facoltativo per gli allenatori)',
      'setup.noteStaff':'Giocatori e staff devono essere approvati da un Super Admin prima di accedere.',
      'setup.noteAdmin':'I Super Admin sono creati direttamente e possono approvare gli altri.',
      'setup.request':'Richiedi accesso','setup.enterAdmin':'Entra come Super Admin',
      'role.super-admin':'Super Admin','role.coach':'Allenatore','role.trainer':'Preparatore','role.player':'Giocatore',
      'pending.title':'In attesa di approvazione','pending.recheck':'Controlla di nuovo','pending.another':'Usa un altro account',
      'pending.sub':'Le approvazioni avvengono nella console Super Admin. Entrerai appena approvato.',
      'denied.title':'Accesso non concesso','denied.another':'Usa un altro account',
      'nav.dashboard':'Dashboard','nav.playbook':'Playbook','nav.basics':'Basi','nav.trivia':'Quiz','nav.admin':'Admin',
      'phase.offense':'Attacco','phase.defense':'Difesa',
      'mode.problem':'Problema','mode.solution':'Soluzione','mode.reveal':'Mostra la soluzione ▶',
      'view.team':'Squadra','view.me':'Il mio ruolo','view.focus':'Focus…',
      'lib.title':'Scenari','lib.new':'+ Nuovo','lib.pick':'Scegli una situazione sopra','lib.select':'Seleziona uno scenario',
      'assign.title':'Compiti','assign.hint':'Cosa fa ogni ruolo',
      'basics.title':'Basi della pallanuoto','basics.sub':'I fondamentali — poi vai al Playbook per vederli in movimento.',
      'basics.rulebooks':'Regolamenti ufficiali — Swiss Aquatics','basics.seePlaybook':'Guarda nel Playbook','basics.testTrivia':'Mettiti alla prova col Quiz',
      'trivia.title':'Quiz Pallanuoto','trivia.start':'Inizia','trivia.again':'Riprova','trivia.back':'Alla dashboard',
      'common.signout':'Esci','common.save':'Salva','common.cancel':'Annulla','common.edit':'Modifica','common.lang':'Lingua',
      'demo.or':'oppure entra subito nella demo','demo.coach':'Demo allenatore','demo.player':'Demo giocatore','demo.admin':'Demo admin',
    },
  };

  let lang = 'en';
  const subs = [];

  function detect() {
    let saved; try { saved = localStorage.getItem(KEY); } catch(e){}
    if (saved && DICT[saved]) return saved;
    const nav = (typeof navigator!=='undefined' && (navigator.language||'')).slice(0,2).toLowerCase();
    return DICT[nav] ? nav : 'en';
  }
  function setLang(l) {
    if (!DICT[l]) l = 'en';
    lang = l;
    try { localStorage.setItem(KEY, l); } catch(e){}
    if (typeof document!=='undefined') { document.documentElement.lang = l; apply(document); }
    subs.forEach(fn => { try { fn(l); } catch(e){} });
  }
  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || (DICT.en && DICT.en[key]) || key;
    if (vars) for (const k in vars) s = s.replace(new RegExp('\\{'+k+'\\}','g'), vars[k]);
    return s;
  }
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
  }
  function onChange(fn){ subs.push(fn); }
  function init(){ lang = detect(); if (typeof document!=='undefined'){ document.documentElement.lang = lang; } }

  return { SUPPORTED, init, setLang, t, apply, onChange, get lang(){ return lang; } };
})();
