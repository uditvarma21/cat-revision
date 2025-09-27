// renderer.js
// Corrected renderer logic for the Electron Study Planner - CAT Edition
// - Proper 12-hour study time calculation with 20/10 pomodoro cycles
// - 1 hour daily answer writing (not per subject)
// - D+1, D+7, D+30 revisions (60 min each) properly scheduled
// - Optimal subject distribution to finish by December end
// - Integrated revision placement in daily schedule

// ---------- CONFIG / SUBJECT DATA ----------
const SUBJECTS = {
  "Quantitative Ability (QA)": 600,
  "Verbal Ability and Reading Comprehension": 400,
  "Data Interpretation and Logical Reasoning": 500
};

// clusters (keeps similar subjects together)
const CLUSTERS = [
  ["Quantitative Ability (QA)"],
  ["Verbal Ability and Reading Comprehension"],
  ["Data Interpretation and Logical Reasoning"]
];

// CORRECTED: Your actual time slots with proper break calculation
const TIME_SLOTS = [
  { start: "05:30", end: "07:00", totalMinutes: 90 },   // 90 minutes -> ~60 productive
  { start: "08:30", end: "13:30", totalMinutes: 300 },  // 300 minutes -> ~200 productive  
  { start: "14:30", end: "16:00", totalMinutes: 90 },   // 90 minutes -> ~60 productive
  { start: "16:30", end: "19:30", totalMinutes: 180 },  // 180 minutes -> ~120 productive
  { start: "20:30", end: "22:30", totalMinutes: 120 }   // 120 minutes -> ~80 productive
];

// Pomodoro policy
const WORK_MIN = 20;
const BREAK_MIN = 10;
const CYCLE_MIN = WORK_MIN + BREAK_MIN; // 30 minutes per cycle

// CORRECTED: Study speed and daily targets
const PAGES_PER_HOUR = 15; // pages per hour when reading + notes
const ANSWER_WRITING_DAILY = 60; // 1 hour daily answer writing (not per subject)

// Schedule window (keeping today for testing as requested)
const makeDateNoTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const today = makeDateNoTime(new Date());
const START_DATE = new Date(today); // keeping as today for testing
const END_DATE = new Date(2025, 11, 31); // Dec 31, 2025

// ---------- HELPERS ----------
const formatDate = (d) => d.toISOString().slice(0,10);
const formatTime = (d) => d.toTimeString().slice(0,5);

// days inclusive between a and b
function daysBetweenInclusive(a,b){
  const A = makeDateNoTime(a).getTime();
  const B = makeDateNoTime(b).getTime();
  return Math.round((B - A)/(24*60*60*1000)) + 1;
}

// parse "HH:MM" into Date for the given day
function timeStrToDate(dayDate, hhmm){
  const [hh,mm] = hhmm.split(":").map(Number);
  return new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hh, mm, 0);
}

// CORRECTED: Calculate productive minutes with proper 20/10 cycle logic
function calculateProductiveMinutes(totalMinutes) {
  const fullCycles = Math.floor(totalMinutes / CYCLE_MIN);
  const remainder = totalMinutes % CYCLE_MIN;
  let productive = fullCycles * WORK_MIN;
  
  // If remainder is enough for a work block, add it (up to WORK_MIN)
  if (remainder > 0) {
    productive += Math.min(remainder, WORK_MIN);
  }
  
  return productive;
}

// CORRECTED: Build work blocks respecting 20 work / 10 break pattern
function buildWorkBlocksForSlot(dayDate, slot){
  const blocks = [];
  const slotStart = timeStrToDate(dayDate, slot.start);
  const slotEnd = timeStrToDate(dayDate, slot.end);
  
  let currentTime = new Date(slotStart);
  
  while(currentTime < slotEnd) {
    // Calculate work block end (20 minutes or remaining time)
    const workDuration = Math.min(WORK_MIN * 60000, slotEnd.getTime() - currentTime.getTime());
    const workEnd = new Date(currentTime.getTime() + workDuration);
    
    if (workDuration > 0) {
      blocks.push({
        start: new Date(currentTime),
        end: new Date(workEnd),
        minutes: Math.round(workDuration / 60000)
      });
    }
    
    // Move to next cycle (add break time if there's still time left)
    currentTime = new Date(workEnd.getTime() + BREAK_MIN * 60000);
  }
  
  return blocks;
}

// round minutes to nearest integer
const roundMin = (m) => Math.max(0, Math.round(m));

// ---------- STORE ----------
let STORE = {
  subjects: JSON.parse(JSON.stringify(SUBJECTS)),
  remaining: JSON.parse(JSON.stringify(SUBJECTS)),
  revisions: [], // { id, origDate, subject, pages, type:'D+1'|'D+7'|'D+30', due:'YYYY-MM-DD', done:false}
  history: [], // {date, subject, pages, studyMinutes, answerMinutes}
  notes: ''
};

// ---------- UI REFS ----------
const sessionsUL = document.getElementById('sessions');
const targetsUL = document.getElementById('targets');
const revisionsUL = document.getElementById('revisions');
const dateDiv = document.getElementById('topic-title') || document.getElementById('date');
const subjectsListDiv = document.getElementById('subjectsList');
const progressDiv = document.getElementById('progress');
const notesTA = document.getElementById('notes');
const subjectsPerDayInput = document.getElementById('subjectsPerDay');

// ---------- CALCULATIONS ----------

// total pages remaining
function totalRemaining(){
  return Object.values(STORE.remaining).reduce((a,b)=>a+b, 0);
}

// CORRECTED: Calculate total productive minutes per day
function totalProductiveMinutesPerDay() {
  return TIME_SLOTS.reduce((total, slot) => {
    return total + calculateProductiveMinutes(slot.totalMinutes);
  }, 0);
}

// number of study days left from START_DATE inclusive to END_DATE inclusive
function studyDaysLeft(fromDate = START_DATE){
  const refDate = makeDateNoTime(fromDate) < makeDateNoTime(START_DATE) ? START_DATE : fromDate;
  if(makeDateNoTime(refDate) > makeDateNoTime(END_DATE)) return 0;
  return daysBetweenInclusive(refDate, END_DATE);
}

// CORRECTED: Calculate pages per day needed to finish on time
function calculateDailyPageTarget() {
  const daysLeft = studyDaysLeft();
  const totalPages = totalRemaining();
  if (daysLeft <= 0) return totalPages; // finish whatever remains
  return Math.ceil(totalPages / daysLeft);
}

// CORRECTED: Calculate study minutes available per day (excluding answer writing)
function studyMinutesAvailablePerDay() {
  const totalProductive = totalProductiveMinutesPerDay();
  return totalProductive - ANSWER_WRITING_DAILY; // Reserve 1 hour for answer writing
}

// pick cluster for a day index (0-based) relative to START_DATE
function clusterForDate(d){
  const daysDiff = Math.floor((makeDateNoTime(d) - makeDateNoTime(START_DATE))/(24*60*60*1000));
  return CLUSTERS[((daysDiff % CLUSTERS.length) + CLUSTERS.length) % CLUSTERS.length];
}

// create today's work blocks
function buildTodayWorkBlocks(dayDate){
  const blocks = [];
  for(const slot of TIME_SLOTS){
    const slotBlocks = buildWorkBlocksForSlot(dayDate, slot);
    blocks.push(...slotBlocks);
  }
  return blocks;
}

// CORRECTED: Session placement with proper overflow handling
function placeSessionsInBlocks(blocks, sessions){
  const blocksCopy = blocks.map(b => ({ 
    ...b, 
    freeMinutes: b.minutes, 
    assignments: [] 
  }));
  
  const placed = [];
  const overflow = [];

  for(const session of sessions){
    let remainingMinutes = session.minutes;
    const sessionParts = [];
    
    for(const block of blocksCopy){
      if(remainingMinutes <= 0) break;
      if(block.freeMinutes <= 0) continue;
      
      const assignedMinutes = Math.min(remainingMinutes, block.freeMinutes);
      const usedMinutes = block.minutes - block.freeMinutes;
      const partStart = new Date(block.start.getTime() + usedMinutes * 60000);
      const partEnd = new Date(partStart.getTime() + assignedMinutes * 60000);
      
      sessionParts.push({
        start: partStart,
        end: partEnd,
        minutes: assignedMinutes
      });
      
      block.freeMinutes -= assignedMinutes;
      remainingMinutes -= assignedMinutes;
    }
    
    if(remainingMinutes <= 0){
      placed.push({ ...session, parts: sessionParts });
    } else {
      overflow.push({ 
        ...session, 
        parts: sessionParts,
        unplacedMinutes: remainingMinutes 
      });
    }
  }
  
  return { placed, overflow, blocks: blocksCopy };
}

// ---------- PLANNING LOGIC ----------

// CORRECTED: Select subjects for a given day with better distribution
function selectSubjectsForDay(dayDate, subjectsCount = 3) {
  if(makeDateNoTime(dayDate) < makeDateNoTime(START_DATE)) return [];
  if(makeDateNoTime(dayDate) > makeDateNoTime(END_DATE)) return [];
  
  // Start with cluster subjects
  const cluster = clusterForDate(dayDate);
  const candidates = [];
  
  // Add subjects from current cluster that have remaining pages
  for(const subject of cluster) {
    if((STORE.remaining[subject] || 0) > 0) {
      candidates.push(subject);
    }
  }
  
  // If we need more subjects, add from other clusters
  const allSubjects = Object.keys(STORE.remaining).filter(s => (STORE.remaining[s] || 0) > 0);
  const otherSubjects = allSubjects.filter(s => !candidates.includes(s));
  
  // Sort by remaining pages (descending) to prioritize larger subjects
  otherSubjects.sort((a, b) => (STORE.remaining[b] || 0) - (STORE.remaining[a] || 0));
  
  // Take up to subjectsCount subjects
  const selected = [...candidates, ...otherSubjects].slice(0, subjectsCount);
  
  return selected;
}

// CORRECTED: Calculate pages for each subject based on remaining time and priority
function calculateSubjectPages(subjects, availableStudyMinutes) {
  const totalRemainingPages = subjects.reduce((sum, subject) => 
    sum + (STORE.remaining[subject] || 0), 0);
  
  if (totalRemainingPages === 0) return {};
  
  const pagesPerMinute = PAGES_PER_HOUR / 60; // pages per minute
  const maxPagesFromTime = Math.floor(availableStudyMinutes * pagesPerMinute);
  
  // Distribute pages proportionally but ensure we don't exceed remaining
  const distribution = {};
  let totalDistributed = 0;
  
  for (const subject of subjects) {
    const remainingPages = STORE.remaining[subject] || 0;
    const proportionOfTotal = remainingPages / totalRemainingPages;
    const targetPages = Math.min(
      Math.floor(maxPagesFromTime * proportionOfTotal),
      remainingPages
    );
    
    if (targetPages > 0) {
      distribution[subject] = Math.max(1, targetPages); // At least 1 page
      totalDistributed += distribution[subject];
    }
  }
  
  return distribution;
}

// CORRECTED: Build study sessions for a day
function buildNewStudySessionsForDate(dayDate){
  if(makeDateNoTime(dayDate) < makeDateNoTime(START_DATE)) return [];
  if(makeDateNoTime(dayDate) > makeDateNoTime(END_DATE)) return [];

  const subjectsPerDay = Number(subjectsPerDayInput?.value || 3);
  const selectedSubjects = selectSubjectsForDay(dayDate, subjectsPerDay);
  
  if (selectedSubjects.length === 0) return [];
  
  const availableStudyMinutes = studyMinutesAvailablePerDay();
  const pageDistribution = calculateSubjectPages(selectedSubjects, availableStudyMinutes);
  
  const sessions = [];
  
  for (const [subject, pages] of Object.entries(pageDistribution)) {
    if (pages > 0) {
      const studyMinutes = roundMin((pages / PAGES_PER_HOUR) * 60);
      sessions.push({
        kind: 'study',
        subject,
        pages,
        studyMinutes,
        minutes: studyMinutes,
        display: `${subject}: ${pages} pages (${Math.round(studyMinutes/60*10)/10}h study)`
      });
    }
  }
  
  // Add daily answer writing session
  if (sessions.length > 0) {
    sessions.push({
      kind: 'answer_writing',
      subject: 'Answer Writing',
      minutes: ANSWER_WRITING_DAILY,
      display: `Answer Writing: 1 hour (covering today's topics)`
    });
  }
  
  return sessions;
}

// collect revisions due on that date
function collectDueRevisionsForDate(dateStr){
  return (STORE.revisions || []).filter(r => r.due === dateStr && !r.done)
    .map(r => ({
      kind: 'revision',
      subject: r.subject,
      origDate: r.origDate,
      pages: r.pages,
      minutes: 60, // 1 hour for each revision
      type: r.type,
      id: r.id,
      display: `${r.subject} - ${r.type} revision (from ${r.origDate})`
    }));
}

// mark a revision as done
function markRevisionDone(id){
  const revision = (STORE.revisions || []).find(x => x.id === id);
  if(revision) revision.done = true;
}

// CORRECTED: Schedule D+1, D+7, D+30 revisions
function scheduleRevisions(origDateStr, subject, pages){
  if(!STORE.revisions) STORE.revisions = [];
  
  const baseId = `${origDateStr}_${subject}_${Date.now()}`;
  const origDate = new Date(origDateStr + 'T00:00:00');
  
  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return formatDate(result);
  };
  
  // Schedule three revisions
  STORE.revisions.push({
    id: `${baseId}_D1`,
    origDate: origDateStr,
    subject,
    pages,
    type: 'D+1',
    due: addDays(origDate, 1),
    done: false
  });
  
  STORE.revisions.push({
    id: `${baseId}_D7`,
    origDate: origDateStr,
    subject,
    pages,
    type: 'D+7',
    due: addDays(origDate, 7),
    done: false
  });
  
  STORE.revisions.push({
    id: `${baseId}_D30`,
    origDate: origDateStr,
    subject,
    pages,
    type: 'D+30',
    due: addDays(origDate, 30),
    done: false
  });
}

// complete a study session
function completeStudySession(subject, pages, studyMinutes){
  const todayStr = formatDate(new Date());
  STORE.remaining[subject] = Math.max(0, (STORE.remaining[subject] || 0) - pages);
  STORE.history.push({ 
    date: todayStr, 
    subject, 
    pages, 
    studyMinutes,
    type: 'study'
  });
  scheduleRevisions(todayStr, subject, pages);
  saveStoreLocal();
}

// complete answer writing session
function completeAnswerWriting() {
  const todayStr = formatDate(new Date());
  STORE.history.push({
    date: todayStr,
    subject: 'Answer Writing',
    minutes: ANSWER_WRITING_DAILY,
    type: 'answer_writing'
  });
  saveStoreLocal();
}

// ---------- UI RENDERING ----------

function clearElement(el){ 
  if (el) {
    while(el.firstChild) el.removeChild(el.firstChild); 
  }
}

function renderSubjects(){
  if (!subjectsListDiv) return;
  clearElement(subjectsListDiv);
  
  for(const [subject, totalPages] of Object.entries(STORE.subjects)){
    const remaining = STORE.remaining[subject] || 0;
    const completed = totalPages - remaining;
    const percentage = totalPages > 0 ? Math.round((completed / totalPages) * 100) : 100;
    
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px;';
    row.innerHTML = `
      <strong>${subject}</strong>
      <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
        Completed: ${completed}/${totalPages} pages (${percentage}%)
      </div>
      <div style="font-size: 12px; color: #9ca3af;">
        Remaining: ${remaining} pages
      </div>
    `;
    subjectsListDiv.appendChild(row);
  }
}

function renderProgress(){
  if (!progressDiv) return;
  
  const totalPages = Object.values(STORE.subjects).reduce((a,b)=>a+b,0);
  const completed = totalPages - totalRemaining();
  const percentage = totalPages > 0 ? Math.round((completed / totalPages) * 100) : 100;
  const daysLeft = studyDaysLeft();
  const dailyTarget = calculateDailyPageTarget();
  
  progressDiv.innerHTML = `
    <div><strong>CAT Preparation Progress: ${completed}/${totalPages} pages (${percentage}%)</strong></div>
    <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
      Days remaining: ${daysLeft} | Daily target: ${dailyTarget} pages
    </div>
    <div style="font-size: 12px; color: #6b7280;">
      Study time: ${Math.round(studyMinutesAvailablePerDay()/60*10)/10}h + 1h problem solving = ${Math.round(totalProductiveMinutesPerDay()/60*10)/10}h total
    </div>
    <div style="font-size: 10px; color: var(--accent); margin-top: 4px;">
      🎯 CAT 2025 Target: Advanced application-level preparation
    </div>
  `;
}

// CORRECTED: Main plan generator
function generatePlanForDate(dayDate){
  if (!dateDiv) return;
  
  dateDiv.innerText = `Study Plan for ${formatDate(dayDate)}`;
  clearElement(sessionsUL);
  clearElement(targetsUL);
  clearElement(revisionsUL);

  // Check if date is in valid range
  if(makeDateNoTime(dayDate) < makeDateNoTime(START_DATE)){
    const li = document.createElement('li');
    li.innerText = `Study plan starts on ${formatDate(START_DATE)}`;
    if (sessionsUL) sessionsUL.appendChild(li);
    return;
  }
  
  if(makeDateNoTime(dayDate) > makeDateNoTime(END_DATE)){
    const li = document.createElement('li');
    li.innerText = `Study plan ended on ${formatDate(END_DATE)}`;
    if (sessionsUL) sessionsUL.appendChild(li);
    return;
  }

  // Build work blocks
  const workBlocks = buildTodayWorkBlocks(dayDate);
  const totalProductiveTime = workBlocks.reduce((sum, block) => sum + block.minutes, 0);

  // Build sessions (revisions first, then study sessions)
  const dueRevisions = collectDueRevisionsForDate(formatDate(dayDate));
  const studySessions = buildNewStudySessionsForDate(dayDate);
  const allSessions = [...dueRevisions, ...studySessions];

  // Place sessions in time blocks
  const placement = placeSessionsInBlocks(workBlocks, allSessions);

  // Render scheduled sessions
  if (sessionsUL) {
    if (placement.placed.length === 0 && placement.overflow.length === 0) {
      const li = document.createElement('li');
      li.innerText = 'No sessions scheduled for this day';
      sessionsUL.appendChild(li);
    }
    
    // Render successfully placed sessions
    for(const session of placement.placed){
      const li = document.createElement('li');
      li.style.cssText = 'margin-bottom: 12px; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;';
      
      const timeSlots = session.parts.map(part => 
        `${formatTime(part.start)}-${formatTime(part.end)}`
      ).join(', ');
      
      let buttonHtml = '';
      if (session.kind === 'study') {
        buttonHtml = `<button onclick="completeStudySession('${session.subject}', ${session.pages}, ${session.studyMinutes}); generatePlanForDate(new Date('${formatDate(dayDate)}'))" 
                       style="margin-top: 6px; padding: 4px 8px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">
                       Mark Completed</button>`;
      } else if (session.kind === 'answer_writing') {
        buttonHtml = `<button onclick="completeAnswerWriting(); generatePlanForDate(new Date('${formatDate(dayDate)}'))" 
                       style="margin-top: 6px; padding: 4px 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                       Mark Completed</button>`;
      } else if (session.kind === 'revision') {
        buttonHtml = `<button onclick="markRevisionDone('${session.id}'); generatePlanForDate(new Date('${formatDate(dayDate)}'))" 
                       style="margin-top: 6px; padding: 4px 8px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">
                       Mark Completed</button>`;
      }
      
      li.innerHTML = `
        <div><strong>${session.display}</strong></div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">
          Duration: ${session.minutes} minutes
        </div>
        <div style="font-size: 12px; color: #9ca3af;">
          Time: ${timeSlots}
        </div>
        ${buttonHtml}
      `;
      
      sessionsUL.appendChild(li);
    }
    
    // Render overflow sessions
    if (placement.overflow.length > 0) {
      const header = document.createElement('li');
      header.style.cssText = 'margin-top: 20px; padding: 10px; background: #fef3c7; border-radius: 6px;';
      header.innerHTML = `<strong style="color: #d97706;">⚠️ Could not schedule (${placement.overflow.length} sessions)</strong>`;
      sessionsUL.appendChild(header);
      
      for(const session of placement.overflow) {
        const li = document.createElement('li');
        li.style.cssText = 'margin-bottom: 8px; padding: 8px; background: #fef3c7; border-radius: 4px;';
        li.innerHTML = `
          <div><strong>${session.display}</strong></div>
          <div style="font-size: 12px; color: #92400e;">
            Needs ${session.unplacedMinutes} more minutes
          </div>
        `;
        sessionsUL.appendChild(li);
      }
    }
  }

  // Render summary
  renderSubjects();
  renderProgress();
}

// ---------- GLOBAL FUNCTIONS (for button clicks) ----------
window.completeStudySession = completeStudySession;
window.completeAnswerWriting = completeAnswerWriting;
window.markRevisionDone = markRevisionDone;
window.generatePlanForDate = generatePlanForDate;

// ---------- PERSISTENCE ----------
async function saveStoreLocal(){
  try {
    await window.electronAPI.saveStore(STORE);
    console.log('Store saved successfully');
  } catch(e){
    console.error('Save failed:', e);
  }
}

async function loadStoreLocal(){
  try {
    const loadedStore = await window.electronAPI.loadStore();
    if(loadedStore) {
      STORE = {
        subjects: loadedStore.subjects || JSON.parse(JSON.stringify(SUBJECTS)),
        remaining: loadedStore.remaining || JSON.parse(JSON.stringify(SUBJECTS)),
        revisions: loadedStore.revisions || [],
        history: loadedStore.history || [],
        notes: loadedStore.notes || ''
      };
      if (notesTA) notesTA.value = STORE.notes;
    }
  } catch(e){
    console.warn('Load failed:', e);
  }
}

// ---------- POMODORO TIMER ----------
let pomodoro = { 
  running: false, 
  isWork: true, 
  remaining: WORK_MIN * 60, 
  intervalId: null 
};

function updatePomodoroDisplay() {
  // Prefer LIVE scheduler if running
  const liveActive = !!(typeof LIVE !== 'undefined' && LIVE && LIVE.intervalId);
  const remaining = liveActive ? LIVE.remainingSec : pomodoro.remaining;
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
  const seconds = (remaining % 60).toString().padStart(2, '0');
  const display = document.getElementById('timerDisplay');
  const phase = document.getElementById('phase');
  
  if (display) display.innerText = `${minutes}:${seconds}`;
  if (phase) {
    const work = liveActive ? LIVE.isWork : pomodoro.isWork;
    phase.innerText = work ? 'Work' : 'Break';
  }
}

function tickPomodoro(){
  if(pomodoro.remaining <= 0){
    // Switch phase
    pomodoro.isWork = !pomodoro.isWork;
    pomodoro.remaining = (pomodoro.isWork ? WORK_MIN : BREAK_MIN) * 60;
    
    // Send notification
    const title = pomodoro.isWork ? 'Work Time!' : 'Break Time!';
    const body = pomodoro.isWork ? 'Focus on your studies' : 'Take a well-deserved break';
    
    if (window.electronAPI?.notify) {
      window.electronAPI.notify({ title, body });
    }
  }
  
  updatePomodoroDisplay();
  pomodoro.remaining--;
}

function startPomodoro(){
  if(pomodoro.running) return;
  pomodoro.running = true;
  pomodoro.isWork = true;
  pomodoro.remaining = WORK_MIN * 60;
  pomodoro.intervalId = setInterval(tickPomodoro, 1000);
  updatePomodoroDisplay();
}

function stopPomodoro(){
  if(!pomodoro.running) return;
  pomodoro.running = false;
  if(pomodoro.intervalId) {
    clearInterval(pomodoro.intervalId);
    pomodoro.intervalId = null;
  }
  
  const display = document.getElementById('timerDisplay');
  const phase = document.getElementById('phase');
  if (display) display.innerText = '00:00';
  if (phase) phase.innerText = 'Stopped';
}

function skipPomodoroPhase(){
  if(!pomodoro.running) return;
  
  // Clear current interval and switch phase immediately
  if(pomodoro.intervalId) clearInterval(pomodoro.intervalId);
  
  pomodoro.isWork = !pomodoro.isWork;
  pomodoro.remaining = (pomodoro.isWork ? WORK_MIN : BREAK_MIN) * 60;
  
  // Restart interval
  pomodoro.intervalId = setInterval(tickPomodoro, 1000);
  updatePomodoroDisplay();
}

// ---------- EVENT LISTENERS ----------
document.addEventListener('DOMContentLoaded', function() {
  // Save progress button
  const saveBtn = document.getElementById('saveProgress');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (notesTA) STORE.notes = notesTA.value;
      await saveStoreLocal();
      if (window.electronAPI?.notify) {
        window.electronAPI.notify({ 
          title: 'Progress Saved', 
          body: 'Your study progress has been saved successfully' 
        });
      }
    });
  }
  
  // Load progress button
  const loadBtn = document.getElementById('loadProgress');
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      await loadStoreLocal();
      if (window.electronAPI?.notify) {
        window.electronAPI.notify({ 
          title: 'Progress Loaded', 
          body: 'Your study progress has been loaded successfully' 
        });
      }
    });
  }
  
  // Pomodoro controls
  const startPomBtn = document.getElementById('startPom');
  const stopPomBtn = document.getElementById('stopPom');
  const skipPhaseBtn = document.getElementById('skipPhase');
  
  if (startPomBtn) startPomBtn.addEventListener('click', startPomodoro);
  if (stopPomBtn) stopPomBtn.addEventListener('click', stopPomodoro);
  if (skipPhaseBtn) skipPhaseBtn.addEventListener('click', skipPomodoroPhase);
  
  // Subjects per day input change
  if (subjectsPerDayInput) {
    subjectsPerDayInput.addEventListener('change', () => {
      generatePlanForDate(new Date());
    });
  }
});

// ---------- INITIALIZATION ----------
async function initializeApp() {
  try {
    // Load existing data
    await loadStoreLocal();
    
    // Set default subjects per day if not set
    if (subjectsPerDayInput && !subjectsPerDayInput.value) {
      subjectsPerDayInput.value = 3;
    }
    
    // Initial timer display only; live scheduler handles actual countdown
    // Initialize pomodoro display
    updatePomodoroDisplay();
    
    console.log('CAT Study Planner initialized successfully');
    console.log(`Total pages to study: ${Object.values(SUBJECTS).reduce((a,b)=>a+b,0)}`);
    console.log(`Daily productive time: ${totalProductiveMinutesPerDay()} minutes (${Math.round(totalProductiveMinutesPerDay()/60*10)/10} hours)`);
    console.log(`Study time available: ${studyMinutesAvailablePerDay()} minutes after reserving 1h for answer writing`);
    console.log(`Days available: ${studyDaysLeft()} days until ${formatDate(END_DATE)}`);
    
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

// ---------- ADDITIONAL HELPER FUNCTIONS ----------

// Get study statistics
function getStudyStats() {
  const totalPages = Object.values(STORE.subjects).reduce((a,b)=>a+b,0);
  const remainingPages = totalRemaining();
  const completedPages = totalPages - remainingPages;
  const daysElapsed = Math.max(0, daysBetweenInclusive(START_DATE, new Date()) - 1);
  const daysRemaining = studyDaysLeft();
  
  return {
    totalPages,
    completedPages,
    remainingPages,
    completionPercentage: totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0,
    daysElapsed,
    daysRemaining,
    dailyTarget: calculateDailyPageTarget(),
    avgPagesPerDay: daysElapsed > 0 ? Math.round(completedPages / daysElapsed) : 0,
    onTrack: daysElapsed > 0 ? (completedPages / daysElapsed) >= calculateDailyPageTarget() : true
  };
}

// Export progress data
function exportProgress() {
  const stats = getStudyStats();
  const exportData = {
    timestamp: new Date().toISOString(),
    subjects: STORE.subjects,
    remaining: STORE.remaining,
    history: STORE.history,
    revisions: STORE.revisions,
    statistics: stats,
    notes: STORE.notes
  };
  
  return JSON.stringify(exportData, null, 2);
}

// Reset progress (with confirmation)
function resetProgress() {
  if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
    STORE.remaining = JSON.parse(JSON.stringify(SUBJECTS));
    STORE.history = [];
    STORE.revisions = [];
    STORE.notes = '';
    if (notesTA) notesTA.value = '';
    saveStoreLocal();
    generatePlanForDate(new Date());
    
    if (window.electronAPI?.notify) {
      window.electronAPI.notify({ 
        title: 'Progress Reset', 
        body: 'All study progress has been reset' 
      });
    }
  }
}

// Make additional functions globally available
window.getStudyStats = getStudyStats;
window.exportProgress = exportProgress;
window.resetProgress = resetProgress;

// Start the application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// ===================== SCHEDULE-DRIVEN FLOW (AUTO TASK + 20/10) =====================
let LIVE = {
  schedule: null,
  todayBlocks: [],
  currentIdx: -1,
  isWork: true,
  remainingSec: 0,
  intervalId: null,
  subjectTitle: '',
topicLine: '',
topicsData: null,
absences: {},
studyProgress: {}, // Track which subtopics have been studied on which days
};

function hhmmToDate(hhmm) {
  const [hh, mm] = (hhmm||'').split(':').map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh||0, mm||0, 0);
}

function loadTodayScheduleBlocks(scheduleData){
  const todayStr = new Date().toISOString().slice(0,10);
  const entry = (scheduleData?.schedule||[]).find(d => d.date === todayStr);
  if (!entry) return [];
  return (entry.daily_schedule||[]).map(s => ({
    start: hhmmToDate(s.start_time),
    end: hhmmToDate(s.end_time),
    raw: s
  })).sort((a,b)=>a.start-b.start);
}

function findActiveBlock(blocks){
  const now = new Date();
  return blocks.findIndex(b => now >= b.start && now < b.end);
}

function showBreakOverlay(show){
  const o = document.getElementById('break-overlay');
  if (!o) return;
if (show) {
  o.style.display = 'flex';
  o.removeAttribute('hidden');
} else {
  o.style.display = 'none';
  o.setAttribute('hidden','');
}
}

function updateBreakCountdown(){
  const el = document.getElementById('break-countdown');
  if (!el) return;
  const m = Math.max(0, Math.floor(LIVE.remainingSec/60)).toString().padStart(2,'0');
  const s = Math.max(0, LIVE.remainingSec%60).toString().padStart(2,'0');
  el.innerText = `${m}:${s}`;
}

function setPanelTitlesFromTask(task){
  const tt = document.getElementById('topic-title');
  const bc = document.getElementById('breadcrumb');
  if (task?.raw?.activity === 'STUDY_BLOCK'){
    const subj = task.raw.details?.subject || '';
    const firstTopic = (task.raw.details?.topic_group||[])[0] || '';
    tt && (tt.innerText = `📚 Study: ${subj}`);
    bc && (bc.innerText = firstTopic || 'Study Block');
    LIVE.subjectTitle = subj;
    LIVE.topicLine = firstTopic;
  } else if (task?.raw?.activity === 'ANSWER_WRITING'){
    const subj = task.raw.details?.subject || 'Answer Writing';
    tt && (tt.innerText = `✍️ Problem Solving: ${subj}`);
    bc && (bc.innerText = 'Advanced CAT-level practice questions');
    LIVE.subjectTitle = subj;
    LIVE.topicLine = `Answer writing for ${subj}`;
  } else if (task?.raw?.activity === 'REVISION'){
    const rt = task.raw.details?.recall_type || 'Revision';
    tt && (tt.innerText = `🔄 Revision: ${rt}`);
    bc && (bc.innerText = (task.raw.details?.topics_to_recall||[]).join(', ').slice(0,120) || '');
    LIVE.subjectTitle = 'Revision';
    LIVE.topicLine = `Revision: ${rt}`;
  } else {
    tt && (tt.innerText = '');
    bc && (bc.innerText = '');
    LIVE.subjectTitle = '';
    LIVE.topicLine = '';
  }
}

async function maybeGenerateQuestionsForTask(task){
  console.log('maybeGenerateQuestionsForTask called with:', task);
  if (!task) {
    console.log('No task provided');
    return;
  }
  const act = task.raw.activity;
  console.log('Task activity:', act);
  if (act !== 'STUDY_BLOCK' && act !== 'ANSWER_WRITING') {
    console.log('Task is not STUDY_BLOCK or ANSWER_WRITING, skipping');
    return;
  }
  console.log('Subject:', LIVE.subjectTitle, 'Topic:', LIVE.topicLine);
  if (!LIVE.subjectTitle || !LIVE.topicLine) {
    console.log('Missing subject or topic, skipping');
    return;
  }
  try {
    console.log('Calling generateQuestions API...');
    // Determine session type based on activity
    const sessionType = act === 'ANSWER_WRITING' ? 'answer_writing' : 'study';
    const res = await window.electronAPI.generateQuestions({ 
      subjectTitle: LIVE.subjectTitle, 
      topicLine: LIVE.topicLine,
      sessionType: sessionType
    });
    console.log('API response:', res);
    if (res && res.questions) {
      console.log('Questions received:', res.questions.length);
      const ul = document.getElementById('questions-list');
      if (ul) {
        ul.innerHTML = '';
        res.questions.forEach((q, i) => {
          const li = document.createElement('li');
          const difficulty = q.difficulty || 'Medium';
          const difficultyColor = difficulty === 'Very Hard' ? '#dc2626' : difficulty === 'Hard' ? '#f59e0b' : '#10b981';
          li.innerHTML = `
            <div style="margin-bottom: 4px;">
              <span style="font-size: 10px; color: ${difficultyColor}; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px; margin-right: 8px;">${difficulty}</span>
              <span style="font-size: 10px; color: var(--text-dim);">${q.marks} marks</span>
            </div>
            <div>${i+1}. ${q.text}</div>
          `;
          ul.appendChild(li);
        });
        console.log('Questions displayed in UI');
      } else {
        console.log('Questions list element not found');
      }
    } else {
      console.log('No questions in response or error:', res);
    }
  } catch (error) {
    console.error('Error in maybeGenerateQuestionsForTask:', error);
  }
}

async function switchPhaseWithinBlock(){
  // Toggle work/break respecting overlay
  LIVE.isWork = !LIVE.isWork;
  LIVE.remainingSec = (LIVE.isWork ? WORK_MIN : BREAK_MIN) * 60;
  if (LIVE.isWork) {
    showBreakOverlay(false);
    updatePomodoroDisplay();
    if (window.electronAPI?.notify) window.electronAPI.notify({ title: 'Work Time!', body: 'Focus on your studies' });
  } else {
    showBreakOverlay(true);
    updateBreakCountdown();
    if (window.electronAPI?.notify) window.electronAPI.notify({ title: 'Break Time!', body: '10 minutes break' });
  }
}

function withinCurrentBlockTime(){
  const now = new Date();
  const cur = LIVE.todayBlocks[LIVE.currentIdx];
  return cur && now < cur.end;
}

async function enterBlock(index){
  LIVE.currentIdx = index;
  const task = LIVE.todayBlocks[LIVE.currentIdx];
  if (!task) return;
  setPanelTitlesFromTask(task);
renderNowDetails(task);
await renderSubtopics(task);
  await maybeGenerateQuestionsForTask(task);
  
  // Mark current subtopic as studied if it's a study block
  if (task.raw.activity === 'STUDY_BLOCK') {
    markSubtopicAsStudied(task);
  }
  
  // Reset cycle at block start
  LIVE.isWork = true;
  LIVE.remainingSec = WORK_MIN * 60;
  showBreakOverlay(false);
  updatePomodoroDisplay();
}

async function advanceToNextBlock(){
  const next = LIVE.currentIdx + 1;
  if (next < LIVE.todayBlocks.length){
    await enterBlock(next);
  } else {
    // No more blocks today
    if (LIVE.intervalId){ clearInterval(LIVE.intervalId); LIVE.intervalId = null; }
    showBreakOverlay(false);
    const display = document.getElementById('timerDisplay');
    const phase = document.getElementById('phase');
    if (display) display.innerText = '00:00';
    if (phase) phase.innerText = 'Idle';
  }
}

function tickLive(){
  if (LIVE.remainingSec <= 0){
    if (withinCurrentBlockTime()) {
      switchPhaseWithinBlock();
    } else {
      advanceToNextBlock();
    }
  } else {
    LIVE.remainingSec--;
    if (LIVE.isWork) {
      // reuse pomodoro display for left panel timer
      updatePomodoroDisplay();
    } else {
      updateBreakCountdown();
    }
    // End of block check
    if (!withinCurrentBlockTime()) {
      advanceToNextBlock();
    }
  }
}

async function startLiveScheduler(){
  try {
  const [schedRes, topicsRes] = await Promise.all([
    window.electronAPI.loadSchedule(),
    window.electronAPI.loadTopics()
  ]);
  const res = schedRes;
  if (res?.data) {
    LIVE.schedule = res.data;
    LIVE.absences = (res.attendance && res.attendance.absences) || {};
    LIVE.topicsData = topicsRes?.data || null;
    const real = new Date();
    const yyyy = real.toISOString().slice(0,10);
    const daysAbsentBeforeToday = Object.keys(LIVE.absences||{}).filter(d => d < yyyy && LIVE.absences[d]).length;
    const logicalDate = new Date(real.getTime());
    logicalDate.setDate(logicalDate.getDate() - daysAbsentBeforeToday);
    const logicalStr = logicalDate.toISOString().slice(0,10);
    
    console.log('Real date:', yyyy);
    console.log('Days absent before today:', daysAbsentBeforeToday);
    console.log('Logical date:', logicalStr);
    LIVE.todayBlocks = (LIVE.schedule.schedule||[])
      .filter(d => d.date === logicalStr)
      .flatMap(d => (d.daily_schedule||[]))
      .map(s => ({ start: hhmmToDate(s.start_time), end: hhmmToDate(s.end_time), raw: s }))
      .sort((a,b)=>a.start-b.start);
    
    console.log('Filtered schedule for logical date:', logicalStr);
    console.log('Found', LIVE.todayBlocks.length, 'blocks for today');
    if (LIVE.todayBlocks.length > 0) {
      console.log('First block:', LIVE.todayBlocks[0]);
    }
    const idx = findActiveBlock(LIVE.todayBlocks);
    console.log('Found active block index:', idx);
    console.log('Today blocks:', LIVE.todayBlocks.length);
    console.log('Logical date:', logicalStr);
    
    if (idx >= 0) {
      await enterBlock(idx);
      if (LIVE.intervalId) clearInterval(LIVE.intervalId);
      LIVE.intervalId = setInterval(tickLive, 1000);
    } else {
      showBreakOverlay(false);
      const display = document.getElementById('timerDisplay');
      const phase = document.getElementById('phase');
      if (display) display.innerText = '00:00';
      if (phase) phase.innerText = 'Idle';
      renderNowDetails(null);
      await renderSubtopics(null);
    }
    
    // Always render the day schedule regardless of active block status
    console.log('Rendering day schedule for logical date:', logicalStr);
    console.log('About to call renderDayScheduleForLogical');
    
    // Force show something in the right sidebar
    const dayScheduleUl = document.getElementById('day-schedule');
    if (dayScheduleUl) {
      dayScheduleUl.innerHTML = '<li style="color: blue;">Loading schedule for ' + logicalStr + '...</li>';
    }
    
    renderDayScheduleForLogical(logicalStr);
    console.log('renderDayScheduleForLogical completed');
  }
  } catch (e) {
    console.warn('Schedule load failed', e);
  }
}

// Wire extra UI buttons for Gemini chat and regen
function wireQA(){
  const regen = document.getElementById('regenQuestions');
  if (regen) {
    regen.addEventListener('click', async () => {
      console.log('Regenerate button clicked');
      console.log('LIVE object:', LIVE);
      console.log('Schedule loaded:', !!LIVE.schedule);
      console.log('Today blocks:', LIVE.todayBlocks.length);
      console.log('Current index:', LIVE.currentIdx);
      
      if (!LIVE.schedule || LIVE.todayBlocks.length === 0) {
        console.log('Schedule not loaded yet, please wait...');
        alert('Schedule not loaded yet. Please wait a moment and try again.');
        return;
      }
      
      const cur = LIVE.todayBlocks[LIVE.currentIdx];
      console.log('Current task:', cur);
      if (!cur) {
        console.log('No current task found');
        alert('No active study session found. Please wait for a study session to start.');
        return;
      }
      console.log('Calling maybeGenerateQuestionsForTask...');
      await maybeGenerateQuestionsForTask(cur);
    });
  } else {
    console.log('Regenerate button not found in DOM');
  }
  const sendBtn = document.getElementById('chat-send');
  const input = document.getElementById('chat-text');
  if (sendBtn && input){
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const cur = LIVE.todayBlocks[LIVE.currentIdx];
      const subjectTitle = LIVE.subjectTitle || 'CAT Preparation';
      const topicLine = LIVE.topicLine || 'General';
      const box = document.getElementById('chat-messages');
      if (box){
        const me = document.createElement('div'); me.className = 'message user'; me.innerText = text; box.appendChild(me); box.scrollTop = box.scrollHeight;
      }
      // Support command: extra: <focus> to craft an extra question request
      let resp;
      const extraMatch = /^extra\s*:\s*(.+)$/i.exec(text);
      if (extraMatch) {
        const focus = extraMatch[1];
        // Ask for one focused question via question generator with scoped topic
        const q = await window.electronAPI.generateQuestions({ subjectTitle, topicLine: `${topicLine} — Focus: ${focus}` });
        if (q?.questions && q.questions.length) {
          resp = { reply: `Extra focused question: ${q.questions[0].text} (${q.questions[0].marks}m)` };
        } else {
          resp = { reply: 'Could not craft an extra question right now.' };
        }
      } else {
        resp = await window.electronAPI.askGemini({ subjectTitle, topicLine, text });
      }
      if (resp?.error){
        const err = document.getElementById('chat-error'); if (err) err.innerText = resp.error;
        return;
      }
      const err = document.getElementById('chat-error'); if (err) err.innerText = '';
      if (box){
        const ai = document.createElement('div'); ai.className = 'message assistant'; ai.innerText = resp.reply || ''; box.appendChild(ai); box.scrollTop = box.scrollHeight;
      }
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') send(); });
  }
}

// Kick off live scheduler after initial app UI is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded - starting initialization');
  // Ensure overlay hidden on boot
  showBreakOverlay(false);
  loadStudyProgress(); // Load saved study progress
  wireQA();
  startLiveScheduler();
  
  // Test removed - element confirmed working
});

function renderNowDetails(task){
  const box = document.getElementById('now-details');
  if (!box) return;
  if (!task){ box.innerHTML = '<div class="muted">No session currently. Next session will appear here when it starts.</div>'; return; }
  const act = task.raw.activity;
  if (act === 'STUDY_BLOCK'){
    const subj = task.raw.details?.subject || '';
    const topic = (task.raw.details?.topic_group||[])[0] || '';
    const recallDates = task.raw.details?.recall_dates || {};
    let revisionInfo = '';
    if (recallDates.day_1) revisionInfo += `<div style="font-size:10px; color: var(--text-dim);">D+1: ${recallDates.day_1}</div>`;
    if (recallDates.day_7) revisionInfo += `<div style="font-size:10px; color: var(--text-dim);">D+7: ${recallDates.day_7}</div>`;
    if (recallDates.day_30) revisionInfo += `<div style="font-size:10px; color: var(--text-dim);">D+30: ${recallDates.day_30}</div>`;
    box.innerHTML = `<div><strong>${subj}</strong></div><div style="color: var(--text-dim); font-size:12px;">${topic}</div>${revisionInfo}`;
  } else if (act === 'ANSWER_WRITING'){
    const subj = task.raw.details?.subject || '';
    box.innerHTML = `<div><strong>Problem Solving Session</strong></div><div style="color: var(--text-dim); font-size:12px;">${subj}</div><div style="color: var(--accent); font-size:10px;">⏱️ CAT Timing: 2-3 min per question</div>`;
  } else if (act === 'REVISION'){
    const rt = task.raw.details?.recall_type || 'Revision';
    const sourceDate = task.raw.details?.source_date || '';
    const topics = task.raw.details?.topics_to_recall || [];
    let topicsList = topics.length > 0 ? topics.slice(0,3).join(', ') : 'No topics';
    if (topics.length > 3) topicsList += ` (+${topics.length-3} more)`;
    box.innerHTML = `<div><strong>Revision — ${rt}</strong></div><div style="color: var(--text-dim); font-size:12px;">From: ${sourceDate}</div><div style="color: var(--text-dim); font-size:10px;">${topicsList}</div>`;
  } else {
    box.innerHTML = '';
  }
}

function markSubtopicAsStudied(task) {
  if (!task || task.raw.activity !== 'STUDY_BLOCK') return;
  
  const subject = task.raw.details?.subject;
  const firstTopicLine = (task.raw.details?.topic_group||[])[0] || '';
  const parts = firstTopicLine.split(' - ');
  const group = parts[0]?.trim() || '';
  const specificSubtopic = parts[1]?.trim() || '';
  
  if (!subject || !group) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  // For subjects with array format (no subtopics), use the topic name itself
  // For subjects with object format, use the specific subtopic
  const progressKey = specificSubtopic ? 
    `${subject}-${group}-${specificSubtopic}` : 
    `${subject}-${group}`;
  
  // Initialize progress tracking for this subtopic if it doesn't exist
  if (!LIVE.studyProgress[progressKey]) {
    LIVE.studyProgress[progressKey] = [];
  }
  
  // Add today's date if not already recorded
  if (!LIVE.studyProgress[progressKey].includes(today)) {
    LIVE.studyProgress[progressKey].push(today);
    const displayName = specificSubtopic || group;
    console.log(`Marked subtopic as studied: ${displayName} on ${today}`);
    
    // Save progress to localStorage
    saveStudyProgress();
  }
}

function saveStudyProgress() {
  try {
    localStorage.setItem('studyProgress', JSON.stringify(LIVE.studyProgress));
  } catch (error) {
    console.error('Failed to save study progress:', error);
  }
}

function loadStudyProgress() {
  try {
    const saved = localStorage.getItem('studyProgress');
    if (saved) {
      LIVE.studyProgress = JSON.parse(saved);
      console.log('Loaded study progress:', Object.keys(LIVE.studyProgress).length, 'subtopics');
    }
  } catch (error) {
    console.error('Failed to load study progress:', error);
    LIVE.studyProgress = {};
  }
}

async function renderSubtopics(task){
  const ul = document.getElementById('subtopics');
  if (!ul) return;
  ul.innerHTML = '';
  
  if (!task || task.raw.activity !== 'STUDY_BLOCK' || !LIVE.topicsData) {
    ul.innerHTML = '<li class="muted">No study session active</li>';
    return;
  }
  
  const subject = task.raw.details?.subject;
  const firstTopicLine = (task.raw.details?.topic_group||[])[0] || '';
  const parts = firstTopicLine.split(' - ');
  const group = parts[0]?.trim() || '';
  const specificTopic = parts[1]?.trim() || '';
  
  console.log('Looking for subject:', subject, 'group:', group, 'specificTopic:', specificTopic);
  console.log('Available subjects:', Object.keys(LIVE.topicsData || {}));
  
  const subjNode = LIVE.topicsData[subject];
  if (!subjNode) {
    ul.innerHTML = `<li class="muted">Subject "${subject}" not found in topics data</li>`;
    return;
  }
  
  const topicsDict = subjNode.topics;
  if (!topicsDict) {
    ul.innerHTML = `<li class="muted">No topics found for subject "${subject}"</li>`;
    return;
  }
  
  console.log('Available topic groups:', Object.keys(topicsDict));
  console.log('Topics structure:', Array.isArray(topicsDict) ? 'Array format' : 'Object format');
  
  let subTopics = [];
  
  // Handle two different formats:
  // Format 1: "topics": { "TOPIC_NAME": { "sub_topics": [...] } }
  // Format 2: "topics": ["TOPIC_NAME1", "TOPIC_NAME2", ...]
  
  if (Array.isArray(topicsDict)) {
    // Format 2: Array of topic names
    // For subjects like "Quantitative Ability (QA)", the group is the same as the subject
    // and we need to look for the specific topic in the array
    let targetTopic = group;
    if (specificTopic) {
      targetTopic = specificTopic;
    }
    
    const topicIndex = topicsDict.findIndex(topic => topic === targetTopic);
    if (topicIndex === -1) {
      ul.innerHTML = `<li class="muted">Topic "${targetTopic}" not found in "${subject}"</li>`;
      return;
    }
    // For array format, show all topics in the subject
    subTopics = topicsDict;
  } else {
    // Format 1: Object with subtopics
    const groupNode = topicsDict[group];
    if (!groupNode) {
      ul.innerHTML = `<li class="muted">Topic group "${group}" not found in "${subject}"</li>`;
      return;
    }
    
    subTopics = groupNode.sub_topics;
    if (!Array.isArray(subTopics) || subTopics.length === 0) {
      ul.innerHTML = `<li class="muted">No subtopics found for "${group}" in "${subject}"</li>`;
      return;
    }
  }
  
  // Get today's date string for progress tracking
  const today = new Date().toISOString().split('T')[0];
  
  subTopics.forEach((st, index) => {
    const li = document.createElement('li');
    li.className = 'subtopic-item';
    
    // Check if this subtopic has been studied before
    // For array format, use the topic name itself as the key
    // For object format, use the specific subtopic
    const progressKey = Array.isArray(topicsDict) ? 
      `${subject}-${group}` : 
      `${subject}-${group}-${st}`;
    const studyHistory = LIVE.studyProgress[progressKey] || [];
    const hasBeenStudied = studyHistory.length > 0;
    const studiedToday = studyHistory.includes(today);
    
    // Create progress indicator
    let progressMark = '';
    if (hasBeenStudied) {
      const firstStudied = studyHistory[0]; // Get the first study date
      const studyDate = new Date(firstStudied);
      const formattedDate = studyDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
      progressMark = ` ✓ Read on ${formattedDate}`;
      li.className += ' studied-before';
    } else {
      progressMark = ' ⭕ Unread';
      li.className += ' unread';
    }
    
    li.innerHTML = `
      <span class="subtopic-text">${st}</span>
      <span class="progress-mark">${progressMark}</span>
    `;
    
    ul.appendChild(li);
  });
}

function renderDayScheduleForLogical(logicalDateStr){
  const ul = document.getElementById('day-schedule');
  const absentNote = document.getElementById('absent-note');
  const chk = document.getElementById('mark-absent');
  
  console.log('renderDayScheduleForLogical called with:', logicalDateStr);
  console.log('day-schedule element found:', !!ul);
  console.log('absent-note element found:', !!absentNote);
  console.log('mark-absent element found:', !!chk);
  
  if (!ul) {
    console.error('day-schedule element not found!');
    return;
  }
  ul.innerHTML = '';
  
  console.log('Schedule data:', LIVE.schedule);
  console.log('Schedule type:', typeof LIVE.schedule);
  console.log('Schedule keys:', LIVE.schedule ? Object.keys(LIVE.schedule) : 'null');
  console.log('Available dates:', (LIVE.schedule?.schedule||[]).map(d => d.date));
  
  const day = (LIVE.schedule?.schedule||[]).find(d => d.date === logicalDateStr);
  console.log('Found day:', day);
  
  if (!day){ 
    ul.innerHTML = `<li>No plan for ${logicalDateStr}</li>`;
    console.log('No day found for logical date:', logicalDateStr);
    console.log('Available dates in schedule:', (LIVE.schedule?.schedule||[]).map(d => d.date));
    return; 
  }
  
  // If we get here, we found the day - clear the loading message
  ul.innerHTML = '';
  (day.daily_schedule||[]).forEach(s => {
    const li = document.createElement('li');
    let line = `${s.start_time}-${s.end_time} · ${s.activity}`;
    if (s.activity === 'STUDY_BLOCK'){
      const subj = s.details?.subject || '';
      const t = (s.details?.topic_group||[])[0] || '';
      const recallDates = s.details?.recall_dates || {};
      line += ` — ${subj}: ${t}`;
      if (recallDates.day_1 || recallDates.day_7 || recallDates.day_30) {
        line += ` (Rev: D+1:${recallDates.day_1||'N/A'} D+7:${recallDates.day_7||'N/A'} D+30:${recallDates.day_30||'N/A'})`;
      }
    } else if (s.activity === 'REVISION'){
      const rt = s.details?.recall_type || 'Revision';
      const sourceDate = s.details?.source_date || '';
      const topics = s.details?.topics_to_recall || [];
      line += ` — ${rt} from ${sourceDate} (${topics.length} topics)`;
    } else if (s.activity === 'ANSWER_WRITING'){
      const subj = s.details?.subject || '';
      line += ` — ${subj}`;
    }
    li.innerText = line;
    ul.appendChild(li);
  });
  if (chk){
    const realStr = new Date().toISOString().slice(0,10);
    chk.checked = !!LIVE.absences[realStr];
    chk.onchange = async () => {
      const res = await window.electronAPI.toggleAbsent({ date: realStr, absent: chk.checked });
      if (res?.attendance){ LIVE.absences = res.attendance.absences || {}; }
      absentNote && (absentNote.innerText = chk.checked ? 'Marked absent. Plan will shift by one day for future mapping.' : '');
    };
  }
}