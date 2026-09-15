/* Fixture for tests/smoke.mjs [6i]: markup and text the i18n scanner must see (or must not).
   Never loaded by the app. The first three lines are the shapes the scanner used to miss:
   a quoted string that contains the OTHER quote character (every attribute does). */
el.innerHTML = '<span class="muted">Cutting the clip now</span>';
box.innerHTML = "<b data-x='1'>Season tools unavailable</b>";
note.textContent = 'He said "hold the ball" twice';
/* a toast whose text is chosen in code — "Sound on/off" stayed English behind exactly this */
toast(on ? 'Whistle blows now' : 'Whistle stays quiet');
toast(msg || 'Nothing to share yet');
// translated, so nothing to report:
ok.innerHTML = '<span class="muted">' + T('film.cuttingTheClip') + '</span>';
toast(T(on ? 'ui.soundOn' : 'ui.soundOff'));
toast(lane === 'exc' ? T('ui.excludedAddedReentry') : TX('film.usingOnDevice', { n: 2 }));
