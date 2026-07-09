/*******************************
  app.js - SkillSwap (Firebase)
  - Auth (Email/Password)
  - Firestore for users & chats
  - Matching logic (mutual teach/learn)
  - Real-time chat using Firestore onSnapshot
  - No UI changes (uses existing DOM)
*******************************/

/* ==================== Firebase config (user-provided) ==================== */
const firebaseConfig = {
  apiKey: "AIzaSyD8gLpxHZ-WVAVHI-PR9Nk-RmdpDqYpEUQ",
  authDomain: "skillswap-b3510.firebaseapp.com",
  projectId: "skillswap-b3510",
  storageBucket: "skillswap-b3510.firebasestorage.app",
  messagingSenderId: "16259338790",
  appId: "1:16259338790:web:a682226efa9f0949f34ce7",
  measurementId: "G-CL4S1ZNFP0"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ==================== Global state ==================== */
let currentUser = null;          // { uid, name, email, teach[], learn[], profileComplete }
let currentChatUser = null;      // { uid, name, email }
let chatUnsubscribe = null;      // Firestore onSnapshot unsubscribe for current chat
const availableSkills = [
  "Python", "JavaScript", "Painting", "Photography", "Piano",
  "Cooking", "Sketching", "Writing", "Guitar", "Yoga",
  "Data Science", "Web Design", "Digital Marketing", "Spanish",
  "French", "Dance", "Boxing", "Fitness"
];

/* ==================== Utility helpers ==================== */
function $(id) { return document.getElementById(id); }
function escapeHtml(text) {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}
function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function showSuccess(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function clearMessages() {
  document.querySelectorAll('.error-message, .success-message').forEach(el => el.classList.remove('show'));
}

/* ==================== Navigation (no UI change) ==================== */
function showPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const map = {
    landing: 'landingPage', signup: 'signupPage', login: 'loginPage',
    profile: 'profilePage', dashboard: 'dashboardPage',
    matches: 'matchesPage', chat: 'chatPage'
  };
  const id = map[pageName];
  if (id) $(id).classList.add('active');
  updateNavbar();
  if (pageName === 'profile') initializeProfilePage();
  if (pageName === 'dashboard') initializeDashboard();
  if (pageName === 'chat') initializeChatPage();
  window.scrollTo(0, 0);
}

function navigateBack(from) {
  const backMap = { signup: 'landing', login: 'landing', profile: 'landing', dashboard: 'landing', matches: 'dashboard', chat: 'matches' };
  if (backMap[from]) showPage(backMap[from]);
}

function updateNavbar() {
  if (currentUser) {
    $('navLoginBtn').style.display = 'none';
    $('navSignupBtn').style.display = 'none';
    $('navDashboardBtn').style.display = 'inline-block';
    $('navLogoutBtn').style.display = 'inline-block';
  } else {
    $('navLoginBtn').style.display = 'inline-block';
    $('navSignupBtn').style.display = 'inline-block';
    $('navDashboardBtn').style.display = 'none';
    $('navLogoutBtn').style.display = 'none';
  }
}

/* ==================== Auth: signup / login / logout ==================== */
async function handleSignup(e) {
  e.preventDefault();
  clearMessages();
  const name = $('signupName').value.trim();
  const email = $('signupEmail').value.trim().toLowerCase();
  const password = $('signupPassword').value;
  const confirm = $('signupConfirmPassword').value;

  if (!name || !email || !password || !confirm) return showError('signupError', 'All fields are required');
  if (password.length < 6) return showError('signupError', 'Password must be at least 6 characters');
  if (password !== confirm) return showError('signupError', 'Passwords do not match');

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    // Create user doc in Firestore
    await db.collection('users').doc(cred.user.uid).set({
      name,
      email,
      teach: [],
      learn: [],
      profileComplete: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showSuccess('signupSuccess', 'Account created! Redirecting to profile...');
    // auth.onAuthStateChanged will populate currentUser and redirect
    setTimeout(() => showPage('profile'), 1200);
  } catch (err) {
    showError('signupError', err.message);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  clearMessages();
  const email = $('loginEmail').value.trim().toLowerCase();
  const password = $('loginPassword').value;
  if (!email || !password) return showError('loginError', 'All fields are required');

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will load profile and redirect
    showSuccess('loginError', ''); // clear previous
    // determine route after onAuthStateChanged updates currentUser
  } catch (err) {
    showError('loginError', err.message);
  }
}

function logout() {
  // cleanup chat listener
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  auth.signOut();
  currentUser = null;
  currentChatUser = null;
  clearMessages();
  // Reset some UI forms
  const forms = ['signupForm','loginForm','profileForm'];
  forms.forEach(f => { if ($(f)) $(f).reset(); });
  showPage('landing');
}

/* ==================== onAuthStateChanged — keep currentUser synced ==================== */
auth.onAuthStateChanged(async user => {
  if (user) {
    // read user doc
    const doc = await db.collection('users').doc(user.uid).get();
    if (doc.exists) {
      currentUser = { uid: user.uid, ...doc.data() };
    } else {
      // fallback if no doc (shouldn't happen)
      currentUser = { uid: user.uid, name: user.displayName || '', email: user.email, teach: [], learn: [], profileComplete: false };
      await db.collection('users').doc(user.uid).set(currentUser);
    }
    updateNavbar();
    // auto-open dashboard or profile
    if (currentUser.profileComplete) showPage('dashboard');
    else showPage('profile');
  } else {
    currentUser = null;
    updateNavbar();
    showPage('landing');
  }
});

/* ==================== Profile UI: render skill checkboxes & save ==================== */
function initializeProfilePage() {
  const teachContainer = $('teachSkillsContainer');
  const learnContainer = $('learnSkillsContainer');
  if (!teachContainer || !learnContainer) return;
  teachContainer.innerHTML = '';
  learnContainer.innerHTML = '';
  clearMessages();

  availableSkills.forEach((skill, idx) => {
    // teach checkbox
    const labelT = document.createElement('label');
    labelT.className = 'skill-checkbox';
    labelT.innerHTML = `<input type="checkbox" value="${skill}" id="teach-${idx}" onchange="toggleSkillSelection(this)"><span>${skill}</span>`;
    teachContainer.appendChild(labelT);
    // preselect if present
    if (currentUser?.teach?.includes(skill)) {
      labelT.querySelector('input').checked = true;
      labelT.classList.add('selected');
    }

    // learn checkbox
    const labelL = document.createElement('label');
    labelL.className = 'skill-checkbox';
    labelL.innerHTML = `<input type="checkbox" value="${skill}" id="learn-${idx}" onchange="toggleSkillSelection(this)"><span>${skill}</span>`;
    learnContainer.appendChild(labelL);
    if (currentUser?.learn?.includes(skill)) {
      labelL.querySelector('input').checked = true;
      labelL.classList.add('selected');
    }
  });
}

function toggleSkillSelection(cb) {
  const label = cb.closest('.skill-checkbox');
  if (!label) return;
  if (cb.checked) label.classList.add('selected');
  else label.classList.remove('selected');
}

async function handleProfileSetup(e) {
  e.preventDefault();
  clearMessages();
  if (!currentUser) return showError('profileError','You must be logged in');

  const teach = Array.from(document.querySelectorAll('#teachSkillsContainer input:checked')).map(i => i.value);
  const learn = Array.from(document.querySelectorAll('#learnSkillsContainer input:checked')).map(i => i.value);

  if (teach.length === 0) return showError('profileError','Please select at least one skill you can teach');
  if (learn.length === 0) return showError('profileError','Please select at least one skill you want to learn');

  // Save to Firestore
  try {
    await db.collection('users').doc(currentUser.uid).update({
      teach, learn, profileComplete: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // update local copy
    currentUser = { ...currentUser, teach, learn, profileComplete: true };
    showSuccess('profileSuccess','Profile saved! Redirecting to dashboard...');
    setTimeout(() => showPage('dashboard'), 1000);
  } catch (err) {
    showError('profileError', err.message);
  }
}

function editSkills() { showPage('profile'); }

/* ==================== Dashboard — show user skills ==================== */
function initializeDashboard() {
  if (!currentUser) { showPage('landing'); return; }
  $('dashboardWelcome').textContent = `Welcome, ${currentUser.name}!`;

  const teachContainer = $('dashboardTeachSkills');
  const learnContainer = $('dashboardLearnSkills');
  teachContainer.innerHTML = '';
  learnContainer.innerHTML = '';

  if (currentUser.teach && currentUser.teach.length) {
    currentUser.teach.forEach(s => teachContainer.innerHTML += `<span class="skill-badge teach">${escapeHtml(s)}</span>`);
  } else {
    teachContainer.innerHTML = '<p style="color:#666">No skills added yet</p>';
  }

  if (currentUser.learn && currentUser.learn.length) {
    currentUser.learn.forEach(s => learnContainer.innerHTML += `<span class="skill-badge learn">${escapeHtml(s)}</span>`);
  } else {
    learnContainer.innerHTML = '<p style="color:#666">No skills added yet</p>';
  }
}

/* ==================== Matching logic (mutual skills) ==================== */
async function findMatches() {
  if (!currentUser) return showPage('landing');
  showPage('matches');
  const content = $('matchesContent');
  content.innerHTML = `<div style="text-align:center;padding:2rem;"><p>Finding matches...</p></div>`;

  try {
    // Query all users with profileComplete true
    const snap = await db.collection('users').where('profileComplete', '==', true).get();
    const matches = [];
    snap.forEach(doc => {
      const data = doc.data();
      const uid = doc.id;
      if (uid === currentUser.uid) return; // skip self
      // compute matched teach/learn
      const matchedTeach = (data.learn || []).filter(s => (currentUser.teach || []).includes(s)); // they want what I teach
      const matchedLearn = (data.teach || []).filter(s => (currentUser.learn || []).includes(s)); // they teach what I learn
      if (matchedTeach.length > 0 && matchedLearn.length > 0) {
        const score = matchedTeach.length + matchedLearn.length;
        matches.push({ uid, name: data.name, email: data.email, teach: data.teach || [], learn: data.learn || [], matchedTeach, matchedLearn, score });
      }
    });
    // sort by score desc
    matches.sort((a,b) => b.score - a.score);
    displayMatches(matches);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function displayMatches(matches) {
  const content = $('matchesContent');
  content.innerHTML = '';
  if (matches.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">😔</div>
        <h3>No Matches Found</h3>
        <p>We couldn't find any matches based on your current skills. Try updating your skills to find more matches!</p>
        <button class="btn btn-primary" onclick="editSkills()">Update Skills</button>
      </div>
    `;
    return;
  }

  matches.forEach(m => {
    const teachBadges = m.teach.map(s => `<span class="skill-badge teach ${m.matchedLearn.includes(s)?'highlight':''}">${escapeHtml(s)}${m.matchedLearn.includes(s)?' ✓':''}</span>`).join('');
    const learnBadges = m.learn.map(s => `<span class="skill-badge learn ${m.matchedTeach.includes(s)?'highlight':''}">${escapeHtml(s)}${m.matchedTeach.includes(s)?' ✓':''}</span>`).join('');

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-header">
        <h3 class="match-name">${escapeHtml(m.name)}</h3>
        <div class="match-score">Match Score: ${m.score} skill${m.score>1?'s':''}</div>
      </div>
      <div class="match-skills">
        <h4>They Can Teach:</h4>
        <div class="skills-badges">${teachBadges}</div>
      </div>
      <div class="match-skills">
        <h4>They Want to Learn:</h4>
        <div class="skills-badges">${learnBadges}</div>
      </div>
      <div class="match-contact">
        <div class="match-email">📧 ${escapeHtml(m.email)}</div>
        <div class="match-buttons">
          <button class="btn btn-primary btn-small" onclick="openChat('${m.uid}','${escapeHtml(m.name)}','${escapeHtml(m.email)}')">Chat Now</button>
          <button class="btn btn-outline btn-small" onclick="contactEmail('${escapeHtml(m.email)}')">Email</button>
        </div>
      </div>
    `;
    content.appendChild(card);
  });
}

/* ==================== Chat (1:1) using Firestore real-time listeners ==================== */

function getRoomId(a, b) {
  // deterministic room id - string of two uids sorted
  return [a, b].sort().join('_');
}

async function openChat(uid, name, email) {
  if (!currentUser) return showPage('landing');
  currentChatUser = { uid, name, email };
  showPage('chat');
}

async function initializeChatPage() {
  if (!currentUser || !currentChatUser) return showPage('matches');

  $('chatUserName').textContent = `Chat with ${currentChatUser.name}`;
  $('sidebarUserName').textContent = currentChatUser.name;
  $('sidebarUserEmail').textContent = currentChatUser.email;
  $('sidebarTeachSkills').innerHTML = '';
  $('sidebarLearnSkills').innerHTML = '';

  // load their skills
  const doc = await db.collection('users').doc(currentChatUser.uid).get();
  const data = doc.exists ? doc.data() : { teach: [], learn: [] };
  (data.teach || []).forEach(s => $('sidebarTeachSkills').innerHTML += `<span class="skill-badge teach">${escapeHtml(s)}</span>`);
  (data.learn || []).forEach(s => $('sidebarLearnSkills').innerHTML += `<span class="skill-badge learn">${escapeHtml(s)}</span>`);

  // Attach real-time messages listener
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }

  const roomId = getRoomId(currentUser.uid, currentChatUser.uid);
  const messagesDiv = $('chatMessages');
  messagesDiv.innerHTML = `<div style="text-align:center;padding:1rem;color:#666;">Loading messages...</div>`;

  const chatDocRef = db.collection('chats').doc(roomId);
  // Ensure chat doc exists — not strictly necessary
  // Listen to messages subcollection ordered by timestamp
  chatUnsubscribe = chatDocRef.collection('messages').orderBy('timestamp', 'asc').onSnapshot(snapshot => {
    messagesDiv.innerHTML = '';
    if (snapshot.empty) {
      messagesDiv.innerHTML = `<div class="empty-chat-state"><p>No messages yet. Start the conversation!</p></div>`;
    } else {
      snapshot.forEach(doc => {
        const msg = doc.data();
        messagesDiv.appendChild(createMessageElement(msg));
      });
    }
    // scroll to bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }, err => {
    messagesDiv.innerHTML = `<div style="color:red;padding:1rem;">Error loading messages: ${escapeHtml(err.message)}</div>`;
  });

  // Setup input events
  const chatInput = $('chatInput');
  const charCount = $('charCount');
  chatInput.value = '';
  charCount.textContent = '0/500';

  chatInput.addEventListener('input', function() {
    charCount.textContent = `${this.value.length}/500`;
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  const sent = msg.senderId === currentUser.uid;
  div.className = `message-bubble ${sent ? 'message-sent' : 'message-received'}`;
  const ts = msg.timestamp && msg.timestamp.toDate ? msg.timestamp.toDate() : (msg.timestamp ? new Date(msg.timestamp) : new Date());
  const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="message-info">
      <span class="message-sender">${sent ? 'You' : escapeHtml(msg.senderName || 'User')}</span>
    </div>
    <div class="message-text">${escapeHtml(msg.text)}</div>
    <div class="message-timestamp">${escapeHtml(timeStr)}</div>
  `;
  return div;
}

async function sendMessage() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || !currentUser || !currentChatUser) return;
  const roomId = getRoomId(currentUser.uid, currentChatUser.uid);
  const chatRef = db.collection('chats').doc(roomId).collection('messages');
  const payload = {
    senderId: currentUser.uid,
    senderName: currentUser.name || currentUser.email,
    text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await chatRef.add(payload);
    input.value = '';
    $('charCount').textContent = '0/500';
    // messages will appear via onSnapshot
  } catch (err) {
    alert('Message failed: ' + err.message);
  }
}

/* ==================== small helper: email contact ==================== */
function contactEmail(email) {
  window.open(`mailto:${email}`, '_blank');
}

/* ==================== Initialization ==================== */
window.addEventListener('DOMContentLoaded', () => {
  // wire up forms to functions
  const signupForm = $('signupForm'); if (signupForm) signupForm.addEventListener('submit', handleSignup);
  const loginForm = $('loginForm'); if (loginForm) loginForm.addEventListener('submit', handleLogin);
  const profileForm = $('profileForm'); if (profileForm) profileForm.addEventListener('submit', handleProfileSetup);

  // wire logout button
  const logoutBtn = $('navLogoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // default landing page
  showPage('landing');

  // keep nav initial state
  updateNavbar();
});
