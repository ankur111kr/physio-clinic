/* ============================================================
   PHYSIOTHERAPY CLINIC — script.js
   Shared utilities used across all frontend pages
   ============================================================ */

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================
(function () {
  // Inject toast container into DOM
  const container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);

  window.showToast = function (message, type = 'info', duration = 3000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  };
})();

// ============================================================
// AUTH HELPERS
// ============================================================
const Auth = {
  getToken: () => localStorage.getItem('adminToken'),
  getHeaders: () => ({
    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
    'Content-Type': 'application/json'
  }),
  isLoggedIn: () => !!localStorage.getItem('adminToken'),
  logout: () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminName');
    window.location.href = '/admin';
  },
  requireAuth: () => {
    if (!localStorage.getItem('adminToken')) {
      window.location.href = '/admin';
      return false;
    }
    return true;
  }
};

// ============================================================
// API HELPER — Centralized fetch with error handling
// ============================================================
async function api(endpoint, options = {}) {
  const defaults = {
    headers: Auth.getHeaders()
  };
  const config = { ...defaults, ...options };
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  try {
    const res = await fetch(`/api${endpoint}`, config);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('API Error:', err);
    return { ok: false, status: 0, data: { error: 'Network error. Please check your connection.' } };
  }
}

// Public API (no auth header)
async function publicApi(endpoint, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  try {
    const res = await fetch(`/api${endpoint}`, config);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Network error.' } };
  }
}

// ============================================================
// DATE / TIME UTILITIES
// ============================================================
const DateUtils = {
  // Format: "15 Jan 2024"
  formatDate: (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  // Format: "Mon, 15 Jan 2024"
  formatDateFull: (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },
  // Format time: "09:30" → "9:30 AM"
  formatTime: (time) => {
    if (!time) return '—';
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2,'0')} ${ampm}`;
  },
  // Today's date in YYYY-MM-DD
  today: () => new Date().toISOString().split('T')[0],
  // Time ago
  timeAgo: (dateStr) => {
    const now = new Date();
    const past = new Date(dateStr);
    const diff = Math.floor((now - past) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)} days ago`;
    return DateUtils.formatDate(dateStr);
  }
};

// ============================================================
// FORM VALIDATION HELPERS
// ============================================================
const Validate = {
  // Highlight an input as invalid with a message
  setError: (inputId, msg) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.classList.add('is-invalid');
    let feedback = el.nextElementSibling;
    if (!feedback || !feedback.classList.contains('invalid-feedback')) {
      feedback = document.createElement('div');
      feedback.className = 'invalid-feedback';
      el.parentNode.insertBefore(feedback, el.nextSibling);
    }
    feedback.textContent = msg;
  },
  clearError: (inputId) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.classList.remove('is-invalid');
    el.classList.add('is-valid');
  },
  clearAll: (formId) => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    form.querySelectorAll('.is-valid').forEach(el => el.classList.remove('is-valid'));
  },
  isPhone: (val) => /^[+0-9\-\s]{7,15}$/.test(val),
  isEmail: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
  notEmpty: (val) => val && val.trim().length > 0
};

// ============================================================
// LOADING STATES
// ============================================================
const Loader = {
  show: (el, msg = 'Loading...') => {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el._prevHTML = el.innerHTML;
    el.innerHTML = `
      <div class="text-center py-4 text-muted">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div>${msg}
      </div>`;
  },
  hide: (el) => {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el || !el._prevHTML) return;
    el.innerHTML = el._prevHTML;
    delete el._prevHTML;
  },
  // Set button loading state
  btnLoading: (btnId, msg = 'Loading...') => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn._prevText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${msg}`;
  },
  btnReset: (btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn || !btn._prevText) return;
    btn.disabled = false;
    btn.innerHTML = btn._prevText;
    delete btn._prevText;
  }
};

// ============================================================
// COPY TO CLIPBOARD
// ============================================================
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success', 2000);
  } catch {
    showToast('Copy failed.', 'error');
  }
}

// ============================================================
// DEBOUNCE
// ============================================================
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ============================================================
// SCROLL REVEAL (Intersection Observer)
// ============================================================
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
}
document.addEventListener('DOMContentLoaded', initScrollReveal);

// ============================================================
// ADMIN NAV ACTIVE STATE (for sidebar pages)
// ============================================================
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-item a').forEach(a => {
    a.classList.remove('active');
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
}
document.addEventListener('DOMContentLoaded', setActiveNav);

// ============================================================
// CONFIRM DIALOG (Promise-based, nicer than confirm())
// ============================================================
function confirmDialog(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
    // Use Bootstrap modal if available, fallback to native confirm
    if (typeof bootstrap !== 'undefined') {
      const existing = document.getElementById('_confirmModal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = '_confirmModal';
      modal.className = 'modal fade';
      modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-sm">
          <div class="modal-content">
            <div class="modal-header border-0 pb-0">
              <h6 class="modal-title fw-700">${title}</h6>
            </div>
            <div class="modal-body pt-2 text-muted" style="font-size:0.95rem;">${message}</div>
            <div class="modal-footer border-0 pt-0 gap-2">
              <button class="btn btn-secondary btn-sm rounded-pill px-3" id="_confirm-cancel">Cancel</button>
              <button class="btn btn-danger btn-sm rounded-pill px-3" id="_confirm-ok">Confirm</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
      document.getElementById('_confirm-ok').onclick = () => { bsModal.hide(); resolve(true); };
      document.getElementById('_confirm-cancel').onclick = () => { bsModal.hide(); resolve(false); };
    } else {
      resolve(window.confirm(message));
    }
  });
}

// ============================================================
// NUMBER FORMATTER
// ============================================================
function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
}

function formatNumber(num) {
  return new Intl.NumberFormat('en-IN').format(num);
}

// ============================================================
// EXPORT CSV
// ============================================================
function exportToCSV(data, filename = 'export.csv') {
  if (!data || !data.length) return showToast('No data to export.', 'warning');
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!', 'success');
}

// ============================================================
// PRINT HELPERS
// ============================================================
function printPage() {
  window.print();
}

// ============================================================
// WHATSAPP QUICK SEND
// ============================================================
function openWhatsApp(phone, message) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(message);
  window.open(`https://wa.me/91${cleaned}?text=${encoded}`, '_blank');
}

// ============================================================
// RAZORPAY HELPER
// ============================================================
async function openRazorpay({ amount, appointmentId, patientName, phone, onSuccess, onError }) {
  try {
    const { ok, data } = await publicApi('/payment/create-order', {
      method: 'POST',
      body: { amount, appointmentId }
    });

    if (!ok) {
      if (onError) onError(data.error || 'Payment setup failed');
      return;
    }

    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency || 'INR',
      name: 'PhysioPlus Clinic',
      description: 'Consultation Fee',
      order_id: data.orderId,
      handler: async function (response) {
        const verifyRes = await publicApi('/payment/verify', {
          method: 'POST',
          body: {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            appointmentId
          }
        });
        if (verifyRes.ok) {
          if (onSuccess) onSuccess(response);
        } else {
          if (onError) onError('Payment verification failed.');
        }
      },
      prefill: { name: patientName, contact: phone },
      theme: { color: '#1a56db' },
      modal: { ondismiss: () => { if (onError) onError('Payment cancelled.'); } }
    };

    if (typeof Razorpay === 'undefined') {
      if (onError) onError('Payment service not loaded.');
      return;
    }

    const rzp = new Razorpay(options);
    rzp.open();
  } catch (err) {
    if (onError) onError('Payment error: ' + err.message);
  }
}

// ============================================================
// STATS COUNTER ANIMATION
// ============================================================
function animateCounter(el, target, duration = 1200) {
  let start = 0;
  const step = Math.ceil(target / (duration / 16));
  const timer = setInterval(() => {
    start += step;
    if (start >= target) { start = target; clearInterval(timer); }
    el.textContent = formatNumber(start);
  }, 16);
}

// Auto-animate any element with data-count attribute
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.getAttribute('data-count'));
    if (!isNaN(target)) animateCounter(el, target);
  });
});
