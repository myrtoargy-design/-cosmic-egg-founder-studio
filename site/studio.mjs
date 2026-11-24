import { deriveKey, fromBase64, open, PROGRESS_CONTEXT, QUESTIONNAIRE_CONTEXT, seal, validateQuestionnaire } from './crypto.mjs';

const labels = {
  confirmed: 'Επιβεβαιώθηκε',
  changed: 'Άλλαξε',
  pending: 'Pending',
  unanswered: 'Χωρίς απάντηση',
};
const emptyAnswer = { status: 'unanswered', answer: '', choices: [] };
const $ = (id) => document.getElementById(id);
const statusInputs = new Map();
let session;

function message(id, text = '') {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

for (const [status, label] of Object.entries(labels)) {
  const input = element('input');
  input.type = 'radio';
  input.name = 'decision-status';
  input.value = status;
  statusInputs.set(status, input);
  const wrapper = element('label');
  wrapper.append(input, element('span', label));
  $('statuses').append(wrapper);
}

function decision(question) {
  return session.answers.get(question.id) ?? emptyAnswer;
}

async function restoreProgress(current) {
  try {
    const stored = localStorage.getItem(current.storageId);
    if (!stored) return;
    const progress = await open(current.key, JSON.parse(stored), PROGRESS_CONTEXT);
    const position = current.questions.findIndex((question) => question.id === progress.lastQuestion);
    current.index = Math.max(0, position);
    for (const question of current.questions) {
      const saved = Object.hasOwn(progress.answers, question.id) && progress.answers[question.id];
      if (saved && Object.hasOwn(labels, saved.status) && typeof saved.answer === 'string') {
        const choices = Array.isArray(saved.choices) ? saved.choices.filter((choice) => question.options?.includes(choice)) : [];
        current.answers.set(question.id, { ...saved, choices });
      }
    }
  } catch {
    current.canSave = false;
    message('save-status', 'Η τοπική πρόοδος δεν ήταν διαθέσιμη. Εξαγάγετε τις νέες απαντήσεις πριν φύγετε από τη σελίδα.');
  }
}

function saveProgress() {
  const current = session;
  if (!current.canSave) return;
  const progress = {
    lastQuestion: current.questions[current.index].id,
    answers: Object.fromEntries(current.answers),
  };
  current.saving = current.saving.then(async () => {
    const encrypted = await seal(current.key, progress, PROGRESS_CONTEXT);
    localStorage.setItem(current.storageId, JSON.stringify(encrypted));
    message('save-status');
  }).catch(() => {
    message('save-status', 'Η αποθήκευση στη συσκευή απέτυχε. Εξαγάγετε τις απαντήσεις πριν φύγετε από τη σελίδα.');
  });
}

function renderProgress() {
  const total = session.questions.length;
  const recorded = session.questions.filter((question) => decision(question).status !== 'unanswered').length;
  $('progress').value = recorded;
  $('progress').max = total;
  $('progress-text').textContent = `${recorded} / ${total}`;
}

function updateAnswer(changes) {
  const question = session.questions[session.index];
  const value = { ...decision(question), ...changes };
  if (value.status === 'unanswered' && !value.answer && !value.choices.length) session.answers.delete(question.id);
  else session.answers.set(question.id, value);
  renderProgress();
  saveProgress();
}

function displayQuestion(focus = true) {
  const question = session.questions[session.index];
  const value = decision(question);
  $('question-location').textContent = `${question.section} · ${session.index + 1} / ${session.questions.length}`;
  $('question-title').textContent = question.title;
  message('question-context', question.why);
  message('question-source', `Πηγή · ${question.source}`);
  message('question-owner', `Υπεύθυνος · ${question.owner}`);
  message('question-note', question.note);
  $('question-recommendation').textContent = Array.isArray(question.recommended)
    ? question.recommended.join('\n')
    : question.recommended ?? '';
  $('recommendation-panel').hidden = !question.recommended;
  $('choices-panel').hidden = question.type === 'text';
  $('choices').replaceChildren(...(question.options ?? []).map((choice) => {
    const input = element('input');
    input.type = question.type === 'multi' ? 'checkbox' : 'radio';
    input.name = 'decision-choice';
    input.value = choice;
    input.checked = value.choices.includes(choice);
    const label = element('label');
    label.append(input, element('span', choice));
    return label;
  }));
  $('answer').placeholder = question.placeholder ?? '';
  $('answer').value = value.answer;
  statusInputs.get(value.status).checked = true;
  $('sections').value = question.section;
  $('back').disabled = session.index === 0;
  $('next').textContent = session.index === session.questions.length - 1 ? 'Τελική επισκόπηση' : 'Επόμενη';
  $('review-view').hidden = true;
  $('review-list').replaceChildren();
  $('question-view').hidden = false;
  $('open-review').disabled = false;
  if (focus) $('question-title').focus();
}

function goTo(index) {
  session.index = index;
  saveProgress();
  displayQuestion();
}

function exportRows() {
  return session.questions.map((question, index) => {
    const value = decision(question);
    return {
      number: index + 1,
      id: question.id,
      section: question.section,
      question: question.title,
      context: question.why,
      source: question.source,
      recommendation: question.recommended ?? '',
      choices: value.choices,
      status: labels[value.status],
      answer: value.answer,
    };
  });
}

function download(extension, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = element('a');
  link.href = url;
  link.download = `cosmic-egg-v7.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join('\n') : String(value);
  if (/^\s*[=+@-]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function review() {
  const counts = Object.fromEntries(Object.keys(labels).map((status) => [status, 0]));
  const list = document.createDocumentFragment();
  let lastSection;
  session.questions.forEach((question, index) => {
    const value = decision(question);
    counts[value.status] += 1;
    if (lastSection !== question.section) {
      list.append(element('h3', question.section));
      lastSection = question.section;
    }
    const row = element('div', undefined, 'review-row');
    const button = element('button', `${index + 1}. ${question.title}`);
    button.type = 'button';
    button.addEventListener('click', () => goTo(index));
    row.append(button, element('p', labels[value.status], 'review-status'));
    for (const choice of value.choices) row.append(element('p', choice, 'copy'));
    if (value.answer) row.append(element('p', value.answer, 'copy'));
    list.append(row);
  });
  $('totals').replaceChildren(...Object.entries(labels).map(([status, label]) => {
    const item = element('div');
    item.append(element('dt', label), element('dd', counts[status]));
    return item;
  }));
  $('review-list').replaceChildren(list);
  message('review-message');
  $('question-view').hidden = true;
  $('review-view').hidden = false;
  $('open-review').disabled = true;
  $('review-title').focus();
}

$('unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('password').value;
  $('password').value = '';
  $('password').disabled = true;
  $('unlock').disabled = true;
  message('unlock-message', 'Ξεκλείδωμα…');
  try {
    if (!globalThis.crypto?.subtle) {
      message('unlock-message', 'Ανοίξτε τη σελίδα μέσω HTTPS σε σύγχρονο πρόγραμμα περιήγησης.');
      return;
    }
    const response = await fetch('./questionnaire.enc.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Questionnaire unavailable');
    const envelope = await response.json();
    if (envelope.format !== 1) throw new Error('Unsupported file format');
    const key = await deriveKey(password, fromBase64(envelope.salt), envelope.iterations);
    let plaintext;
    try {
      plaintext = await open(key, envelope, QUESTIONNAIRE_CONTEXT);
    } catch {
      message('unlock-message', 'Ο κωδικός δεν είναι σωστός ή το ερωτηματολόγιο έχει αλλοιωθεί.');
      return;
    }
    const dataset = validateQuestionnaire(plaintext);
    const { questions } = dataset;
    const current = {
      key, questions, storageId: `cosmic-egg-v7:${envelope.salt}`,
      index: 0, answers: new Map(), canSave: true, saving: Promise.resolve(),
    };
    await restoreProgress(current);
    session = current;
    $('sections').replaceChildren(...dataset.sections.map((section) => new Option(section, section)));
    $('gate').hidden = true;
    $('studio').hidden = false;
    $('lock').hidden = false;
    renderProgress();
    displayQuestion();
  } catch {
    message('unlock-message', 'Το ερωτηματολόγιο δεν είναι διαθέσιμο. Δοκιμάστε ξανά.');
  } finally {
    $('password').disabled = false;
    $('unlock').disabled = false;
    if (!session) $('password').focus();
  }
});

$('lock').addEventListener('click', async () => {
  const previous = session;
  session = undefined;
  $('lock').hidden = true;
  $('studio').hidden = true;
  $('sections').replaceChildren();
  $('choices').replaceChildren();
  $('review-list').replaceChildren();
  $('totals').replaceChildren();
  for (const id of ['question-title', 'question-location', 'question-context', 'question-source', 'question-owner', 'question-recommendation', 'question-note']) {
    $(id).textContent = '';
  }
  $('answer').value = '';
  $('answer').placeholder = '';
  await previous.saving;
  const hadSaveIssue = !$('save-status').hidden;
  message('save-status');
  message('unlock-message', hadSaveIssue ? 'Κλείδωσε. Η τελευταία τοπική αποθήκευση δεν ολοκληρώθηκε.' : '');
  $('gate').hidden = false;
  $('password').focus();
});

$('choices').addEventListener('change', () => {
  const choices = [...$('choices').querySelectorAll('input:checked')].map((input) => input.value);
  updateAnswer({ choices });
});
$('statuses').addEventListener('change', (event) => updateAnswer({ status: event.target.value }));
$('answer').addEventListener('input', (event) => updateAnswer({ answer: event.target.value }));
$('sections').addEventListener('change', (event) => goTo(session.questions.findIndex((question) => question.section === event.target.value)));
$('back').addEventListener('click', () => goTo(session.index - 1));
$('next').addEventListener('click', () => session.index === session.questions.length - 1 ? review() : goTo(session.index + 1));
$('open-review').addEventListener('click', review);
$('return-question').addEventListener('click', () => displayQuestion());
$('export-json').addEventListener('click', () => download('json', 'application/json', JSON.stringify({ version: 7, decisions: exportRows() }, null, 2)));
$('export-csv').addEventListener('click', () => {
  const rows = exportRows();
  const csv = [Object.keys(rows[0]), ...rows.map((row) => Object.values(row))].map((row) => row.map(csvCell).join(',')).join('\r\n');
  download('csv', 'text/csv;charset=utf-8', '\ufeff' + csv);
});
$('copy-summary').addEventListener('click', async () => {
  const rows = exportRows();
  const lines = ['COSMIC EGG · Founder Decision Studio v7'];
  let lastSection;
  for (const row of rows) {
    if (lastSection !== row.section) lines.push('', row.section);
    lines.push(`${row.number}. ${row.question} — ${row.status}`);
    lines.push(...row.choices);
    if (row.answer) lines.push(row.answer);
    lastSection = row.section;
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    message('review-message', 'Η σύνοψη αντιγράφηκε.');
  } catch {
    message('review-message', 'Η αντιγραφή απέτυχε. Μπορείτε να εξαγάγετε τις απαντήσεις σε JSON ή CSV.');
  }
});
