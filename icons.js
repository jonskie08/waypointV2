/* ------------------------------------------------------------------ *
 *  Waypoint — SVG icon library
 *  Single consistent stroke set (1.8px stroke, round caps/joins).
 *  Usage: WaypointIcons.get('home', { size: 22, className: 'nav-icon' })
 * ------------------------------------------------------------------ */
const WaypointIcons = (() => {
  const PATHS = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1v-9"/>',
    activity: '<path d="M4 12h3l2.5-7 4 14 2.5-7H20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    goals: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5Z"/>',
    food: '<path d="M6 3v8a2 2 0 0 0 2 2v8"/><path d="M6 3v6M9 3v6"/><path d="M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8"/>',
    groceries: '<path d="M3 6h2l1.5 10.5a2 2 0 0 0 2 1.7h8a2 2 0 0 0 2-1.7L20 8H6.5"/><circle cx="9.5" cy="21" r="1"/><circle cx="16.5" cy="21" r="1"/>',
    transport: '<rect x="4" y="6" width="16" height="10" rx="2"/><path d="M4 12h16M7 16v2M17 16v2"/><circle cx="8" cy="19" r="0.6" fill="currentColor"/><circle cx="16" cy="19" r="0.6" fill="currentColor"/>',
    bills: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 18h3"/>',
    shopping: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    entertainment: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/>',
    tuition: '<path d="M2 9 12 4l10 5-10 5-10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M20 9v6"/>',
    income: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    expense: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    savings: '<path d="M5 12a7 7 0 0 1 7-7c3 0 5 1.6 6 3.5h1.5a1 1 0 0 1 0 2H18"/><path d="M5 12v4a3 3 0 0 0 3 3h1v2M17 19v2"/><circle cx="15" cy="10" r="0.6" fill="currentColor"/>',
    other: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    rent: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><rect x="10" y="14" width="4" height="6"/>',
    visa: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="8" cy="12.5" r="2.2"/><path d="M13 11h5M13 14h3"/>',
    remittance: '<path d="M3 12h14M13 7l4 5-4 5"/><path d="M3 7h7M3 17h7"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    check: '<path d="M5 13l4 4 10-10"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    wallet: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
    flag: '<path d="M6 3v18"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>',
    graduation: '<path d="M2 9 12 4l10 5-10 5-10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 6-4 2 2-6 4-2Z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M4.2 12H2.2M21.8 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    system: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M4 19h16"/>',
    piggy: '<path d="M4.5 12.5a6.5 6.5 0 0 1 6.5-6.5c2.7 0 4.6 1.4 5.6 3.2H18a1.2 1.2 0 0 1 0 2.4h-1.1" /><path d="M4.5 12.5v3.7A2.3 2.3 0 0 0 6.8 18.5h.7v2.1M15.3 18.5v2.1" /><circle cx="14" cy="10.4" r="0.6" fill="currentColor"/><path d="M4.5 13.5 2.5 12.8"/>',
  };

  function get(name, opts = {}) {
    const { size = 22, className = "", strokeWidth = 1.8 } = opts;
    const inner = PATHS[name] || PATHS.other;
    return `<svg class="wp-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  const CATEGORY_ICON_MAP = {
    Food: "food", Groceries: "groceries", Transport: "transport", Bills: "bills",
    Phone: "phone", Shopping: "shopping", Entertainment: "entertainment",
    Tuition: "graduation", Rent: "rent", "Visa / Education": "visa",
    Remittance: "remittance", Other: "other",
  };
  function forCategory(cat) { return get(CATEGORY_ICON_MAP[cat] || "other"); }

  return { get, forCategory, PATHS };
})();
