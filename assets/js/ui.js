/* Tiện ích giao diện dùng chung cho các trang HTML thuần mới. Đi kèm assets/css/base.css.
 *   AnCuUI.esc(s)                 — thoát ký tự HTML trước khi ghép chuỗi vào innerHTML
 *   AnCuUI.toast(text, linkHtml)  — thông báo ngắn ở đáy màn hình (cần <div class="toast" id="toast">)
 *   AnCuUI.reveal()               — gắn hiệu ứng hiện dần cho mọi .reveal chưa hiện; tắt khi giảm chuyển động
 *   AnCuUI.vnDateTime(iso)        — '16:00, Thứ Tư 11/11/2026' theo giờ Việt Nam
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var timer;
  function toast(text, linkHtml) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>' +
      '<span>' + esc(text) + (linkHtml ? ' ' + linkHtml : '') + '</span>';
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(function () { el.classList.remove('show'); }, linkHtml ? 7000 : 4000);
  }

  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var io = (!reduce && 'IntersectionObserver' in global) ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -10% 0px' }) : null;
  function reveal() {
    [].slice.call(document.querySelectorAll('.reveal:not(.in)')).forEach(function (el) {
      if (io) io.observe(el); else el.classList.add('in');
    });
  }

  function vnDateTime(iso) {
    var d = new Date(iso);
    var gio = d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
    var ngay = d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    return gio + ', ' + ngay.charAt(0).toUpperCase() + ngay.slice(1);
  }
  function vnDate(iso) { return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }); }

  global.AnCuUI = { esc: esc, toast: toast, reveal: reveal, vnDateTime: vnDateTime, vnDate: vnDate };
})(window);
