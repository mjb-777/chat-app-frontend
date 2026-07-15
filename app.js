/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const API  = 'https://chat-app-production-e68d.up.railway.app';  // ← change if your server is elsewhere
const WS   = 'wss://chat-app-production-e68d.up.railway.app';

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */
const $  = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ini = n => n.trim().split(/\s+/).map(p=>p[0]).join('').slice(0,2).toUpperCase();
const col = n => ['av-0','av-1','av-2','av-3','av-4','av-5','av-6','av-7'][n.charCodeAt(0)%8];
const fmtTime = iso => {
  if (!iso) return '';
  // Ensure the string is treated as UTC on all browsers (mobile Safari needs explicit Z or +00:00)
  const s = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
};
const fmtDate = iso => {
  if (!iso) return '';
  const s = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const d = new Date(s), now = new Date();
  if (d.toDateString()===now.toDateString()) return 'Today';
  const yd = new Date(now); yd.setDate(yd.getDate()-1);
  if (d.toDateString()===yd.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
};
const svgI = (d,w=14) =>
  `<svg width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="${d}"/></svg>`;

function toast(msg, type='', duration=3000) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type : '');
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

async function api(path, method='GET', body=null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  const token = localStorage.getItem('token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body)  opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════════════ */
let me = null;           // { email, username, name }
let activeChat = null;   // { chat_id, name, username, online, ... }
let chatWs     = null;   // WebSocket for active chat
let statusWs   = null;   // WebSocket for presence
let callWs     = null;   // WebSocket for WebRTC signaling
let peerConn   = null;   // RTCPeerConnection
//let localStream = null;  // MediaStream (mic/camera) — stopped on call end
let callInfo   = null;   // { call_id, caller_name, call_type }
let callTimerInterval = null;
let callSeconds = 0;
let isMuted = false;
//let isSpeaker = false;
let page = 0;
let hasMore = true;
let typingTimeout = null;
let chatList = [];       // cached chat list

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════════════════ */
// Tab switching
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Signup
$('signup-btn').addEventListener('click', async () => {
  const name     = $('signup-name').value.trim();
  const username = $('signup-username').value.trim();
  const email    = $('signup-email').value.trim();
  const password = $('signup-password').value;
  $('signup-error').textContent = '';
  if (!name||!username||!email||!password) { $('signup-error').textContent='All fields are required.'; return; }
  if (password.length < 6) { $('signup-error').textContent='Password must be at least 6 characters.'; return; }
  $('signup-btn').disabled = true;
  try {
    await api('/signup','POST',{name,username,email,password});
    $('otp-email-label').textContent = email;
    document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
    document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
    $('tab-otp').classList.add('active');
    toast('OTP sent! Check your email.','success');
  } catch(e) {
    $('signup-error').textContent = e.message;
  } finally {
    $('signup-btn').disabled = false;
  }
});

// OTP verify
$('otp-btn').addEventListener('click', async () => {
  const email = $('signup-email').value.trim();
  const otp   = $('otp-input').value.trim();
  $('otp-error').textContent = '';
  if (!otp) { $('otp-error').textContent='Enter the OTP.'; return; }
  $('otp-btn').disabled = true;
  try {
    await api('/verify-otp','POST',{email, otp});
    toast('Account created! Please sign in.','success');
    $('otp-input').value = '';
    document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
    document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
    $('tab-login').classList.add('active');
    document.querySelector('[data-tab="login"]').classList.add('active');
  } catch(e) {
    $('otp-error').textContent = e.message;
  } finally {
    $('otp-btn').disabled = false;
  }
});

$('otp-back-btn').addEventListener('click', () => {
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  $('tab-signup').classList.add('active');
  document.querySelector('[data-tab="signup"]').classList.add('active');
});

// Login
$('login-btn').addEventListener('click', async () => {
  const email    = $('login-email').value.trim();
  const password = $('login-password').value;
  $('login-error').textContent = '';
  if (!email||!password) { $('login-error').textContent='Enter email and password.'; return; }
  $('login-btn').disabled = true;
  try {
    const data = await api('/login','POST',{email,password});
    localStorage.setItem('token', data.token);
    me = { email: data.email, username: data.username, name: data.name };
    startApp();
  } catch(e) {
    $('login-error').textContent = e.message;
  } finally {
    $('login-btn').disabled = false;
  }
});

// Enter key on login
[$('login-email'),$('login-password')].forEach(el =>
  el.addEventListener('keydown', e => { if(e.key==='Enter') $('login-btn').click(); })
);

// Logout
$('logout-btn').addEventListener('click', () => {
  if (!confirm('Sign out?')) return;
  doLogout();
});

function doLogout() {
  localStorage.removeItem('token');
  me = null; activeChat = null;
  stopLocalStream();
  if (statusWs) { statusWs.onclose = null; statusWs.close(); statusWs = null; }
  if (chatWs)   { chatWs.onclose = null;   chatWs.close();   chatWs   = null; }
  if (callWs)   { callWs.close(); callWs = null; }
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('chat-panel').innerHTML = `<div class="empty-state" id="empty-state">
    <div class="empty-icon"><svg width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
    <h2>Select a conversation</h2><p>Choose from your chats on the left</p></div>`;
}

// auto-login on page load
window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const data = await api('/dashboard');
    me = { email: data.email, username: data.username, name: data.name };
    startApp();
  } catch {
    localStorage.removeItem('token');
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════════════════════════════════════ */
function startApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  loadChatList();
  connectStatusWs();
  setupResizer();
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS WEBSOCKET (presence + call notifications)
═══════════════════════════════════════════════════════════════════════════ */
function connectStatusWs() {
  const token = localStorage.getItem('token');
  statusWs = new WebSocket(`${WS}/ws/status/${token}`);

  statusWs.onmessage = e => {
    const data = JSON.parse(e.data);

    if (data.type === 'presence') {
      // match by email (backend sends the user's email)
      const c = chatList.find(x => x.email === data.email || x.username === data.username);
      if (c) {
        c.online = data.status === 'online';
        c.last_seen = data.last_seen;
        updateContactPresenceUI(c);
        if (activeChat && activeChat.chat_id === c.chat_id) {
          activeChat.online = c.online;
          activeChat.last_seen = c.last_seen;
          updateChatHeaderStatus(c);
        }
      }
    }

    if (data.type === 'message_deleted') {
      // real-time delete-for-all: update the bubble in open chat
      const el = document.querySelector(`[data-msg-id="${data.message_id}"] .bubble`);
      if (el) {
        el.className = 'bubble deleted-msg';
        el.innerHTML = 'This message was deleted';
        el.querySelector('.msg-menu-btn')?.remove();
      }
    }

    if (data.type === 'new_message_notify') {
      const c = chatList.find(x => x.chat_id === data.chat_id);
      if (c) {
        c.last_message = { text: data.text, sender: data.sender_email, timestamp: data.timestamp };
        if (data.chat_id !== activeChat?.chat_id) {
          c.unread_count = (c.unread_count || 0) + 1;
          if (!c.muted) toast(`New message from ${c.name}`);
        }
      }
      renderChatList(chatList);
    }

    if (data.type === 'incoming_call') {
      showIncomingCall(data);
    }

    if (data.type === 'call_cancelled') {
      if (!document.getElementById('call-overlay')?.classList.contains('hidden') && callInfo && !callInfo.is_caller) {
        endCall(false);
        toast('Missed call');
      }
    }

    if (data.type === 'call_declined') {
      const ov = document.getElementById('call-overlay');
      if (ov && !ov.classList.contains('hidden')) {
        endCall(false);
        toast('Call was declined', 'error');
      }
    }
  };

  statusWs.onclose = () => {
    setTimeout(connectStatusWs, 3000); // reconnect
  };
}




/* ═══════════════════════════════════════════════════════════════════════════
   CHAT LIST
═══════════════════════════════════════════════════════════════════════════ */
async function loadChatList() {
  try {
    chatList = await api('/chat/list');
    renderChatList(chatList);
  } catch(e) {
    toast('Failed to load chats: '+e.message,'error');
  } finally {
    $('list-spinner')?.remove();
  }
}

function renderChatList(list, filter='') {
  const container = $('contact-list');
  container.innerHTML = '';
  const filtered = list.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
  if (!filtered.length) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">No conversations yet</div>';
    return;
  }
  filtered.forEach(c => container.appendChild(buildContactItem(c)));
}

function buildContactItem(c) {
  const item = document.createElement('div');
  item.className = 'contact-item' + (activeChat?.chat_id===c.chat_id?' active':'') + (c.pinned?' pinned':'');
  item.dataset.chatId = c.chat_id;

  const hasUnread = c.unread_count > 0;
  const lm = c.last_message;
  const previewText = lm ? (lm.sender===me.email ? 'You: '+lm.text : lm.text) : 'No messages yet';
  const timeStr     = lm ? fmtTime(lm.timestamp) : '';

  item.innerHTML = `
    <div class="avatar ${col(c.name)}">${ini(c.name)}</div>
    <div class="contact-info">
      <div class="contact-row1">
        <span class="contact-name">${esc(c.name)}</span>
        <div class="contact-meta">
          ${hasUnread ? `<span class="unread-badge">${c.unread_count}</span>` : ''}
          <span class="contact-time">${timeStr}</span>
        </div>
      </div>
      <div class="contact-preview-row">
        <span class="status-dot ${c.online?'online':''}"></span>
        <span class="contact-preview ${hasUnread?'unread':''}">${esc(previewText)}</span>
      </div>
    </div>
    <button class="more-btn" title="Options">
      <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
      </svg>
    </button>`;

  item.addEventListener('click', e => {
    if (e.target.closest('.more-btn')) return;
    openChat(c);
    showChatMobile();
  });

  item.querySelector('.more-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (ddOpen) { closeDropdown(); return; }
    openDropdown(contactMenuItems(c), e.currentTarget);
  });

  return item;
}

function updateContactPresenceUI(c) {
  const item = document.querySelector(`[data-chat-id="${c.chat_id}"]`);
  if (!item) return;
  const dot = item.querySelector('.status-dot');
  if (dot) { dot.className = 'status-dot' + (c.online?' online':''); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPEN CHAT
═══════════════════════════════════════════════════════════════════════════ */
function openChat(c) {
  if (activeChat?.chat_id === c.chat_id) return;

  // close old chat WS
  if (chatWs) { chatWs.onclose = null; chatWs.close(); chatWs = null; }

  activeChat = { ...c };  // shallow copy so mutations don't affect chatList entry
  c.unread_count = 0;
  activeChat.unread_count = 0;
  page = 0; hasMore = true;

  // highlight in list and immediately clear unread badge
  document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
  const item = document.querySelector(`[data-chat-id="${c.chat_id}"]`);
  if (item) {
    item.classList.add('active');
    item.querySelector('.unread-badge')?.remove();
    const preview = item.querySelector('.contact-preview');
    if (preview) preview.classList.remove('unread');
  }

  buildChatPanel(c);
  fetchMessages(c.chat_id, 0, true);
  connectChatWs(c.chat_id);
}

function buildChatPanel(c) {
  const panel = $('chat-panel');
  panel.innerHTML = `
    <div class="chat-header">
      <button class="back-btn" id="back-btn">
        <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div class="avatar ${col(c.name)}" id="chat-av">${ini(c.name)}</div>
      <div class="chat-header-info">
        <div class="cname">${esc(c.name)}</div>
        <div class="cusername">@${esc(c.username)}</div>
        <div class="cstatus ${c.online?'online':''}" id="chat-status">
          ${c.online ? 'Online' : (c.last_seen ? 'Last seen ' + fmtTime(c.last_seen) : 'Offline')}
        </div>
      </div>
      <div class="chat-header-actions">
        <button class="icon-btn" id="audio-call-btn" title="Audio call">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.73 18a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
        <button class="icon-btn" id="video-call-btn" title="Video call">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </button>
        <button class="icon-btn" id="chat-more-btn" title="More options">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
      </div>
    </div>
    <div class="typing-indicator" id="typing-indicator">
      <span class="typing-dots"><span></span><span></span><span></span></span>
      <span>Typing…</span>
    </div>
    <div class="messages-wrap" id="messages-wrap"></div>
    <div class="input-bar">
      <textarea class="msg-input" id="msg-input" rows="1" placeholder="Type a message…"></textarea>
      <button class="send-btn" id="send-btn">
        <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>`;

  $('back-btn').addEventListener('click', () => {
    activeChat = null;
    hideChatMobile();
    document.querySelectorAll('.contact-item').forEach(el=>el.classList.remove('active'));
    panel.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <h2>Select a conversation</h2><p>Choose from your chats on the left</p></div>`;
    if (chatWs) { chatWs.close(); chatWs=null; }
  });

  $('audio-call-btn').addEventListener('click', () => startCall('audio'));
  $('video-call-btn').addEventListener('click', () => startCall('video'));

  $('chat-more-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (ddOpen) { closeDropdown(); return; }
    openDropdown(chatMenuItems(activeChat), e.currentTarget);
  });

  const inp = $('msg-input');
  const sbtn = $('send-btn');
  inp.addEventListener('keydown', e => {
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  inp.addEventListener('input', handleTyping);
  sbtn.addEventListener('click', sendMessage);

  // load more on scroll to top
  let _loadingMore = false;
  $('messages-wrap').addEventListener('scroll', () => {
    const w = $('messages-wrap');
    if (w.scrollTop < 80 && hasMore && !_loadingMore) {
      _loadingMore = true;
      page++;
      fetchMessages(activeChat.chat_id, page, false).finally(() => {
        _loadingMore = false;
      });
    }
  });
}

function updateChatHeaderStatus(c) {
  const st = $('chat-status');
  if (!st) return;
  if (c.online) {
    st.textContent = 'Online';
    st.className = 'cstatus online';
  } else {
    st.textContent = c.last_seen ? 'Last seen ' + fmtTime(c.last_seen) : 'Offline';
    st.className = 'cstatus';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGES
═══════════════════════════════════════════════════════════════════════════ */
async function fetchMessages(chat_id, pg, reset) {
  try {
    // Show spinner at top when loading older messages
    const wrap = $('messages-wrap');
    let topSpinner = null;
    if (!reset && wrap) {
      topSpinner = document.createElement('div');
      topSpinner.className = 'load-spinner';
      topSpinner.innerHTML = '<div class="spinner"></div>';
      wrap.prepend(topSpinner);
    }

    const msgs = await api(`/chat/messages?chat_id=${chat_id}&page=${pg}&limit=20`);
    if (msgs.length < 20) hasMore = false;

    if (!wrap) return;
    topSpinner?.remove();

    if (reset) {
      wrap.innerHTML = '';
      if (msgs.length === 0) {
        wrap.innerHTML = '<div class="no-msgs-placeholder">No messages yet. Say hello! 👋</div>';
        return;
      }
    }

    const scrollBefore = wrap.scrollHeight;
    const scrollTop    = wrap.scrollTop;
    renderMessages(msgs, !reset);
    if (!reset) {
      // keep scroll position stable
      wrap.scrollTop = wrap.scrollHeight - scrollBefore + scrollTop;
    } else {
      wrap.scrollTop = wrap.scrollHeight;
    }
  } catch(e) {
    toast('Could not load messages: '+e.message,'error');
  }
}

function renderMessages(msgs, prepend=false) {
  const wrap = $('messages-wrap');
  if (!wrap) return;
  let lastDate = null;
  const frag = document.createDocumentFragment();

  msgs.forEach(m => {
    const d = fmtDate(m.timestamp);
    if (d !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-sep'; sep.textContent = d;
      frag.appendChild(sep);
      lastDate = d;
    }
    frag.appendChild(buildMsgEl(m));
  });

  if (prepend) wrap.prepend(frag);
  else wrap.appendChild(frag);
}

function buildMsgEl(m) {
  const isSent = m.sender === me.email;
  const isRead  = m.read_by && m.read_by.length > 1;
  const div = document.createElement('div');
  div.className = `msg ${isSent?'sent':'recv'}`;
  div.dataset.msgId = m.id;

  const bubbleText = m.fully_deleted ? 'This message was deleted' : esc(m.text);
  const bubbleCls  = m.fully_deleted ? 'bubble deleted-msg' : 'bubble';

  div.innerHTML = `
    <div class="${bubbleCls}" style="position:relative">
      ${bubbleText}
      ${!m.fully_deleted ? `<button class="msg-menu-btn" title="Options">⋯</button>` : ''}
    </div>
    <div class="msg-footer">
      <span class="msg-time">${fmtTime(m.timestamp)}</span>
      ${isSent ? `<span class="read-tick">${isRead ? '✓✓' : '✓'}</span>` : ''}
    </div>`;

  div.querySelector('.msg-menu-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (ddOpen) { closeDropdown(); return; }
    openDropdown(msgMenuItems(m, isSent), e.currentTarget);
  });

  return div;
}

function appendMessage(m) {
  const wrap = $('messages-wrap');
  if (!wrap) return;
  // remove "no messages" placeholder
  const placeholder = wrap.querySelector('div[style]');
  if (placeholder) placeholder.remove();

  const d = fmtDate(m.timestamp);
  const lastSep = wrap.querySelectorAll('.date-sep');
  const lastSepText = lastSep.length ? lastSep[lastSep.length-1].textContent : null;
  if (d !== lastSepText) {
    const sep = document.createElement('div');
    sep.className='date-sep'; sep.textContent=d;
    wrap.appendChild(sep);
  }
  wrap.appendChild(buildMsgEl(m));
  wrap.scrollTop = wrap.scrollHeight;
}

function updateReadTick(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"] .read-tick`);
  if (el) el.textContent = '✓✓';
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAT WEBSOCKET
═══════════════════════════════════════════════════════════════════════════ */
function connectChatWs(chat_id) {
  const token = localStorage.getItem('token');
  chatWs = new WebSocket(`${WS}/ws/chat/${chat_id}/${token}`);

  chatWs.onmessage = e => {
    const data = JSON.parse(e.data);

    if (data.type === 'message') {
      if (data.sender === me.email) {
        // Replace the optimistic tmp bubble with the real message id
        const tmpEls = $('messages-wrap')?.querySelectorAll('[data-msg-id^="tmp-"]');
        if (tmpEls && tmpEls.length > 0) {
          tmpEls[tmpEls.length - 1].dataset.msgId = data.id;
        }
        // update chat list preview inline
        const c = chatList.find(x => x.chat_id === activeChat?.chat_id);
        if (c) {
          c.last_message = { text: data.text, sender: data.sender, timestamp: data.timestamp };
          const previewEl = document.querySelector(`[data-chat-id="${c.chat_id}"] .contact-preview`);
          if (previewEl) previewEl.textContent = 'You: ' + data.text;
          const timeEl = document.querySelector(`[data-chat-id="${c.chat_id}"] .contact-time`);
          if (timeEl) timeEl.textContent = fmtTime(data.timestamp);
        }
      } else {
        appendMessage(data);
        // immediately send read receipt since the chat is open
        chatWs.send(JSON.stringify({ action: 'read', message_id: data.id }));
      }
    }

    if (data.type === 'read_receipt') {
      updateReadTick(data.message_id);
    }

    if (data.type === 'typing') {
      showTyping(data.sender, data.active);
    }

    if (data.type === 'message_deleted') {
      const el = document.querySelector(`[data-msg-id="${data.message_id}"] .bubble`);
      if (el) {
        el.className = 'bubble deleted-msg';
        el.innerHTML = 'This message was deleted';
        el.querySelector?.('.msg-menu-btn')?.remove();
      }
    }
  };

  chatWs.onclose = () => {
    // try to reconnect if still in same chat
    if (activeChat?.chat_id === chat_id) {
      setTimeout(() => connectChatWs(chat_id), 2000);
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEND MESSAGE
═══════════════════════════════════════════════════════════════════════════ */
function sendMessage() {
  const inp = $('msg-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) return;

  chatWs.send(JSON.stringify({ action: 'send', text }));
  inp.value = '';
  inp.style.height = '';

  // optimistic UI — append immediately with a temp id
  const now = new Date().toISOString();
  const tmpId = 'tmp-' + Date.now();
  appendMessage({ id: tmpId, sender: me.email, text, timestamp: now, read_by: [me.email] });

  // stop typing signal
  chatWs.send(JSON.stringify({ action: 'typing', active: false }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   TYPING
═══════════════════════════════════════════════════════════════════════════ */
function handleTyping() {
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
  chatWs.send(JSON.stringify({ action: 'typing', active: true }));
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    chatWs?.send(JSON.stringify({ action: 'typing', active: false }));
  }, 2000);
}

function showTyping(senderEmail, active) {
  const ind = $('typing-indicator');
  if (!ind) return;
  if (active) {
    ind.classList.add('show');
    clearTimeout(window._typingHide);
    window._typingHide = setTimeout(() => ind.classList.remove('show'), 3000);
  } else {
    ind.classList.remove('show');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DROPDOWN
═══════════════════════════════════════════════════════════════════════════ */
const ddEl = $('dropdown');
let ddOpen = false;

function openDropdown(items, anchor) {
  ddEl.innerHTML = '';
  items.forEach(item => {
    if (item === 'sep') {
      const s = document.createElement('div'); s.className = 'dd-sep'; ddEl.appendChild(s); return;
    }
    const el = document.createElement('div');
    el.className = 'dd-item' + (item.danger?' danger':'') + (item.disabled?' disabled':'');
    el.innerHTML = (item.icon||'') + `<span>${esc(item.label)}</span>`;
    if (!item.disabled) el.addEventListener('mousedown', e => { e.stopPropagation(); closeDropdown(); item.fn(); });
    ddEl.appendChild(el);
  });
  ddEl.classList.add('show');
  ddOpen = true;

  const r = anchor.getBoundingClientRect();
  const W = 195, H = ddEl.scrollHeight || 160;
  let top = r.bottom + 6, left = r.right - W;
  if (top + H > window.innerHeight - 8) top = r.top - H - 6;
  if (left < 8) left = 8;
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
  ddEl.style.top = top+'px'; ddEl.style.left = left+'px';
}

function closeDropdown() { ddEl.classList.remove('show'); ddOpen = false; }
document.addEventListener('mousedown', e => { if (ddOpen && !ddEl.contains(e.target)) closeDropdown(); });
document.addEventListener('keydown',   e => { if (e.key==='Escape') closeDropdown(); });

/* contact three-dot menu */
function contactMenuItems(c) {
  return [
    { label: 'Open chat', icon: svgI('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
      fn: () => { openChat(c); showChatMobile(); } },
    { label: c.pinned ? 'Unpin' : 'Pin conversation',
      icon: svgI('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'),
      fn: async () => {
        try {
          const res = await api(`/chat/${c.chat_id}/pin`, 'POST');
          c.pinned = res.pinned;
          toast(res.pinned ? 'Pinned!':'Unpinned', 'success');
          loadChatList();
        } catch(e) { toast(e.message,'error'); }
      }
    },
    { label: c.muted ? 'Unmute' : 'Mute notifications',
      icon: svgI('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0'),
      fn: async () => {
        try {
          const res = await api(`/chat/${c.chat_id}/mute`, 'POST');
          c.muted = res.muted;
          toast(res.muted ? 'Muted':'Unmuted', 'success');
        } catch(e) { toast(e.message,'error'); }
      }
    },
    'sep',
    { label: 'Delete conversation', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'), danger: true,
      fn: async () => {
        if (!confirm('Delete this conversation?')) return;
        try {
          await api(`/chat/${c.chat_id}`, 'DELETE');
          if (activeChat?.chat_id===c.chat_id) {
            activeChat=null;
            if (chatWs) { chatWs.close(); chatWs=null; }
            $('chat-panel').innerHTML = `<div class="empty-state">
              <div class="empty-icon"><svg width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
              <h2>Select a conversation</h2><p>Choose from your chats on the left</p></div>`;
            hideChatMobile();
          }
          loadChatList();
        } catch(e) { toast(e.message,'error'); }
      }
    }
  ];
}

/* chat header three-dot menu */
function chatMenuItems(c) {
  return [
    { label: 'View profile', icon: svgI('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'),
      fn: () => toast(`@${c.username}`) },
    { label: 'Audio call', icon: svgI('M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.73 18a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z'),
      fn: () => startCall('audio') },
    { label: 'Video call', icon: svgI('M23 7l-7 5 7 5V7zM1 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'),
      fn: () => startCall('video') },
    'sep',
    { label: 'Clear chat', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'),
      fn: async () => {
        if (!confirm('Clear all messages in this chat?')) return;
        try {
          await api(`/chat/${c.chat_id}/clear`, 'DELETE');
          toast('Chat cleared', 'success');
          fetchMessages(c.chat_id, 0, true);
          loadChatList();
        } catch(e) { toast(e.message,'error'); }
      }
    },
    { label: 'Delete conversation', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'), danger: true,
      fn: async () => {
        if (!confirm('Delete this conversation for you?')) return;
        try {
          await api(`/chat/${c.chat_id}`, 'DELETE');
          activeChat=null;
          if (chatWs) { chatWs.close(); chatWs=null; }
          $('chat-panel').innerHTML = `<div class="empty-state">
            <div class="empty-icon"><svg width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <h2>Select a conversation</h2><p>Choose from your chats on the left</p></div>`;
          hideChatMobile();
          loadChatList();
        } catch(e) { toast(e.message,'error'); }
      }
    }
  ];
}

/* message bubble three-dot menu */
function msgMenuItems(m, isSent) {
  return [
    { label: 'Copy text', icon: svgI('M8 17.929H6c-1.105 0-2-.897-2-2V5c0-1.103.895-2 2-2h8c1.104 0 2 .897 2 2v1h2c1.104 0 2 .897 2 2v12c0 1.103-.896 2-2 2H10c-1.104 0-2-.897-2-2v-2z'),
      fn: () => { navigator.clipboard.writeText(m.text); toast('Copied!'); }
    },
    ...(isSent ? [
      'sep',
      { label: 'Delete for me', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'),
        fn: async () => {
          try {
            await api(`/chat/message/${m.id}?mode=me`, 'DELETE');
            document.querySelector(`[data-msg-id="${m.id}"]`)?.remove();
          } catch(e) { toast(e.message,'error'); }
        }
      },
      { label: 'Delete for everyone', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'), danger: true,
        fn: async () => {
          try {
            await api(`/chat/message/${m.id}?mode=all`, 'DELETE');
            const el = document.querySelector(`[data-msg-id="${m.id}"] .bubble`);
            if (el) { el.className='bubble deleted-msg'; el.innerHTML='This message was deleted'; el.querySelector('.msg-menu-btn')?.remove(); }
          } catch(e) { toast(e.message,'error'); }
        }
      }
    ] : [
      'sep',
      { label: 'Delete for me', icon: svgI('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'),
        fn: async () => {
          try {
            await api(`/chat/message/${m.id}?mode=me`, 'DELETE');
            document.querySelector(`[data-msg-id="${m.id}"]`)?.remove();
          } catch(e) { toast(e.message,'error'); }
        }
      }
    ])
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADD NEW CHAT
═══════════════════════════════════════════════════════════════════════════ */
$('fab-btn').addEventListener('click', () => {
  const p = $('add-popup');
  p.classList.toggle('show');
  if (p.classList.contains('show')) $('new-chat-input').focus();
});
$('close-popup-btn').addEventListener('click', () => $('add-popup').classList.remove('show'));
$('add-chat-btn').addEventListener('click', addNewChat);
$('new-chat-input').addEventListener('keydown', e => { if(e.key==='Enter') addNewChat(); });

async function addNewChat() {
  const username = $('new-chat-input').value.trim();
  if (!username) return;
  $('add-chat-btn').disabled = true;
  try {
    // verify user exists first
    await api(`/user/search?username=${encodeURIComponent(username)}`);
    const res = await api('/chat/create', 'POST', { username });
    $('add-popup').classList.remove('show');
    $('new-chat-input').value = '';
    await loadChatList();
    const c = chatList.find(x => x.chat_id === res.chat_id);
    if (c) { openChat(c); showChatMobile(); }
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    $('add-chat-btn').disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════════════════════════════ */
$('search-toggle-btn').addEventListener('click', () => {
  const w = $('search-wrap');
  const vis = w.style.display !== 'none';
  w.style.display = vis ? 'none' : 'block';
  if (!vis) $('search-input').focus();
  else { $('search-input').value=''; renderChatList(chatList); }
});
$('search-input').addEventListener('input', e => renderChatList(chatList, e.target.value));

/* ═══════════════════════════════════════════════════════════════════════════
   RESIZER
═══════════════════════════════════════════════════════════════════════════ */
function setupResizer() {
  const resizer = $('resizer');
  const sidebar = $('sidebar');
  let resizing=false, startX=0, startW=0;
  resizer.addEventListener('mousedown', e => {
    resizing=true; startX=e.clientX; startW=sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.documentElement.style.cursor='col-resize';
    document.documentElement.style.userSelect='none';
  });
  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const newW = Math.min(Math.max(startW+(e.clientX-startX), 220), window.innerWidth*0.55);
    sidebar.style.width=newW+'px'; sidebar.style.minWidth=newW+'px';
  });
  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing=false; resizer.classList.remove('dragging');
    document.documentElement.style.cursor=''; document.documentElement.style.userSelect='';
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MOBILE
═══════════════════════════════════════════════════════════════════════════ */
function showChatMobile() {
  if (window.innerWidth <= 768) {
    $('sidebar').classList.add('slide-out');
    $('chat-panel').classList.add('slide-in');
  }
}
function hideChatMobile() {
  if (window.innerWidth <= 768) {
    $('sidebar').classList.remove('slide-out');
    $('chat-panel').classList.remove('slide-in');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUDIO / VIDEO CALLS  (WebRTC + signaling via WS)
═══════════════════════════════════════════════════════════════════════════ */
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function genCallId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let localStream = null; // track local media stream globally for cleanup

async function requestMediaPermission(type) {
  try {
    const constraints = { audio: true, video: type === 'video' };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch(err) {
    const msg = err.name === 'NotAllowedError'
      ? `Please allow ${type === 'video' ? 'camera and microphone' : 'microphone'} access to make calls.`
      : `Could not access ${type === 'video' ? 'camera/microphone' : 'microphone'}: ${err.message}`;
    toast(msg, 'error');
    return null;
  }
}

async function startCall(type) {
  if (!activeChat) return;
  if (!activeChat.online) { toast('User is offline', 'error'); return; }

  const calleeEmail = activeChat.email;
  if (!calleeEmail) { toast('Cannot resolve contact for call', 'error'); return; }

  // Ask for media permission BEFORE starting call
  const stream = await requestMediaPermission(type);
  if (!stream) return;
  localStream = stream;

  const call_id = genCallId();
  callInfo = { call_id, caller_name: me.name, call_type: type, is_caller: true, other_name: activeChat.name };

  connectCallWs(call_id);

  callWs.addEventListener('open', () => {
    callWs.send(JSON.stringify({
      action:       'offer',
      call_type:    type,
      callee_email: calleeEmail
    }));
  }, { once: true });

  showCallOverlay('outgoing', type, activeChat.name);
}

function connectCallWs(call_id) {
  const token = localStorage.getItem('token');
  callWs = new WebSocket(`${WS}/ws/call/${call_id}/${token}`);

  callWs.onmessage = async e => {
    const data = JSON.parse(e.data);

    if (data.type === 'call_answered') {
      peerConn = createPeerConn();
      if (localStream) {
        localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));
        if (callInfo.call_type === 'video') showLocalVideo(localStream);
      }
      const offer = await peerConn.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: callInfo.call_type === 'video' });
      await peerConn.setLocalDescription(offer);
      callWs.send(JSON.stringify({ action: 'offer_sdp', sdp: peerConn.localDescription }));
    }

    if (data.type === 'answer_sdp') {
      if (peerConn) {
        await peerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushIceCandidates();
        activateCall();
      }
    }

    if (data.type === 'offer_sdp') {
      peerConn = createPeerConn();
      if (localStream) {
        localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));
        if (callInfo.call_type === 'video') showLocalVideo(localStream);
      }
      await peerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushIceCandidates();
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);
      callWs.send(JSON.stringify({ action: 'answer_sdp', sdp: peerConn.localDescription }));
      activateCall();
    }

    if (data.type === 'ice_candidate') {
      if (!data.candidate) return;
      if (peerConn && peerConn.remoteDescription) {
        try { await peerConn.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      } else {
        iceCandidateBuffer.push(data.candidate);
      }
    }

    if (data.type === 'call_declined') {
      toast('Call was declined', 'error');
      endCall(false);
    }

    if (data.type === 'call_ended' || data.type === 'call_cancelled') {
      toast('Call ended');
      endCall(false);
    }

    if (data.type === 'call_status' && data.status === 'offline') {
      toast('User is offline', 'error');
      endCall(false);
    }
  };

  callWs.onerror = () => { toast('Call connection error', 'error'); endCall(false); };
}

let iceCandidateBuffer = [];

function createPeerConn() {
  const ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  };
  const pc = new RTCPeerConnection(ICE);
  iceCandidateBuffer = [];

  pc.onicecandidate = e => {
    if (e.candidate && callWs?.readyState === WebSocket.OPEN) {
      callWs.send(JSON.stringify({ action: 'ice', candidate: e.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('WebRTC state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      toast('Call connection failed', 'error');
      // guard: only end if overlay still visible
      const ov = document.getElementById('call-overlay');
      if (ov && !ov.classList.contains('hidden')) endCall(false);
    }
  };

  pc.ontrack = e => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    const isVideo = callInfo?.call_type === 'video';

    if (isVideo) {
      // attach to video element — handles both audio and video tracks
      const rv = document.getElementById('remote-video');
      if (rv) {
        if (!rv.srcObject) rv.srcObject = stream;
        else { stream.getTracks().forEach(t => { if (!rv.srcObject.getTracks().includes(t)) rv.srcObject.addTrack(t); }); }
        rv.classList.remove('hidden');
      }
    } else {
      // audio call
      let audio = document.getElementById('remote-audio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remote-audio';
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
      }
      if (!audio.srcObject) audio.srcObject = stream;
      audio.play().catch(() => {});
    }
  };

  return pc;
}

async function flushIceCandidates() {
  for (const c of iceCandidateBuffer) {
    try { await peerConn.addIceCandidate(new RTCIceCandidate(c)); } catch {}
  }
  iceCandidateBuffer = [];
}

function showLocalVideo(stream) {
  const lv = $('local-video');
  if (lv) { lv.srcObject = stream; lv.classList.remove('hidden'); }
}

/* incoming call from status WS */
function showIncomingCall(data) {
  callInfo = {
    call_id:     data.call_id,
    caller_name: data.caller_name,
    call_type:   data.call_type,
    is_caller:   false,
    other_name:  data.caller_name
  };
  showCallOverlay('incoming', data.call_type, data.caller_name);
}

function showCallOverlay(direction, type, name) {
  const ov      = document.getElementById('call-overlay');
  const incoming = document.getElementById('call-incoming');
  const active   = document.getElementById('call-active');
  const avIn    = document.getElementById('call-avatar-in');
  const nmIn    = document.getElementById('call-name-in');
  const lbl     = document.getElementById('call-type-label');
  if (!ov) return;
  ov.classList.remove('hidden');
  if (incoming) incoming.classList.remove('hidden');
  if (active)   active.classList.add('hidden');
  if (avIn)   { avIn.className = `call-avatar ${col(name)}`; avIn.textContent = ini(name); }
  if (nmIn)     nmIn.textContent = name;
  if (lbl)      lbl.textContent = direction === 'incoming' ? `Incoming ${type} call` : `Calling… (${type})`;
}

function activateCall() {
  const incoming = document.getElementById('call-incoming');
  const active   = document.getElementById('call-active');
  const box      = document.querySelector('.call-box');
  if (incoming) incoming.classList.add('hidden');
  if (active)   active.classList.remove('hidden');
  const displayName = callInfo?.other_name || callInfo?.caller_name || '';
  const avAct  = document.getElementById('call-avatar-act');
  const nmAct  = document.getElementById('call-name-act');
  if (avAct) { avAct.className = `call-avatar ${col(displayName)}`; avAct.textContent = ini(displayName); }
  if (nmAct)   nmAct.textContent = displayName;
  if (box && callInfo?.call_type === 'video') box.classList.add('video-mode');
  startCallTimer();
}

function startCallTimer() {
  callSeconds = 0;
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s = String(callSeconds%60).padStart(2,'0');
    const t = $('call-timer');
    if (t) t.textContent = `${m}:${s}`;
  }, 1000);
}

function endCall(sendHangup = true) {
  clearInterval(callTimerInterval);
  callTimerInterval = null;
  callSeconds = 0;

  // stop all local media tracks
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (peerConn) { peerConn.close(); peerConn = null; }

  if (callWs) {
    if (sendHangup && callWs.readyState === WebSocket.OPEN) {
      callWs.send(JSON.stringify({ action: 'hangup' }));
    }
    callWs.close();
    callWs = null;
  }

  // clean up remote audio
  const audio = document.getElementById('remote-audio');
  if (audio) { audio.srcObject = null; audio.remove(); }

  // clean up video elements
  const rv = document.getElementById('remote-video');
  if (rv) { rv.srcObject = null; rv.classList.add('hidden'); }
  const lv = document.getElementById('local-video');
  if (lv) { lv.srcObject = null; lv.classList.add('hidden'); }

  // hide overlay — guard each element in case DOM not ready
  const overlay  = document.getElementById('call-overlay');
  const incoming = document.getElementById('call-incoming');
  const active   = document.getElementById('call-active');
  const box      = document.querySelector('.call-box');
  const muteBtn  = document.getElementById('mute-btn');

  if (overlay)  overlay.classList.add('hidden');
  if (incoming) incoming.classList.remove('hidden');
  if (active)   active.classList.add('hidden');
  if (box)      box.classList.remove('video-mode');
  if (muteBtn)  muteBtn.classList.remove('active');

  isMuted = false;
  isSpeaker = false;
  callInfo = null;
}

$('call-accept-btn').addEventListener('click', async () => {
  if (!callInfo) return;
  // ask for media permission before accepting
  const stream = await requestMediaPermission(callInfo.call_type);
  if (!stream) return;
  localStream = stream;

  connectCallWs(callInfo.call_id);
  callWs.addEventListener('open', () => {
    callWs.send(JSON.stringify({ action: 'answer' }));
  }, { once: true });
  // activateCall() is called when offer_sdp arrives
});

$('call-decline-btn').addEventListener('click', () => {
  if (!callInfo) return;
  const call_id = callInfo.call_id;
  const token   = localStorage.getItem('token');
  const tmp = new WebSocket(`${WS}/ws/call/${call_id}/${token}`);
  tmp.addEventListener('open', () => {
    tmp.send(JSON.stringify({ action: 'decline' }));
    setTimeout(() => tmp.close(), 500);
  });
  endCall(false);
});

$('end-call-btn').addEventListener('click', () => endCall(true));

$('mute-btn').addEventListener('click', () => {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  }
  $('mute-btn').classList.toggle('active', isMuted);
  $('mute-btn').title = isMuted ? 'Unmute' : 'Mute';
});

// Loudspeaker toggle (audio calls)
let isSpeaker = false;
$('speaker-btn').addEventListener('click', async () => {
  isSpeaker = !isSpeaker;
  $('speaker-btn').classList.toggle('active', isSpeaker);
  $('speaker-btn').title = isSpeaker ? 'Switch to earpiece' : 'Loudspeaker';
  const audio = document.getElementById('remote-audio');
  if (audio && audio.setSinkId) {
    // try to route to speaker or earpiece
    try {
      if (isSpeaker) {
        await audio.setSinkId('');  // default output = speaker on most devices
      }
    } catch(e) { /* setSinkId not supported on all browsers */ }
  }
  toast(isSpeaker ? 'Loudspeaker on' : 'Earpiece');
});
