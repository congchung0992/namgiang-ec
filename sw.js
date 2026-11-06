/* Service worker Nam Giang E&C: nhận thông báo đẩy (Web Push) và hiện trên điện thoại, máy tính kể cả khi đã đóng web.
   Bấm vào thông báo thì mở đúng trang (phiếu cần duyệt…). Không lưu đệm trang, không chạy gì khác. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Nam Giang E&C", {
    body: d.body || "", icon: "img/mark.png", badge: "img/mark.png", tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(L => {
    for (const c of L) if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
