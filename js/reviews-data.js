/* =============================================================================
 * RESOUL — Google 評價離線後備資料
 * -----------------------------------------------------------------------------
 * 正常情況由 /api/google-reviews 讀取後台已發佈的評價；只有 API 暫時不可用時才用此清單：
 *   • name   ——  顯示的稱呼（例如「小白的主人」）
 *   • rating ——  星數 1–5（通常填 5）
 *   • zh     ——  中文評價內容
 *   • en     ——  英文評價內容（英文版網站會顯示；可留空 "" 則沿用中文）
 *   • photo  ——  相片網址（可選）。留空 "" 就唔會顯示相片；
 *                 要加相片，可放 Google 相片的公開連結，或網站 images/ 內的檔案，
 *                 例如 "images/review-momo.jpg"
 *
 * 管理員請到後台「照顧誌留言 → 管理 Google 評價」修改網站展示內容。
 * ============================================================================= */
window.RESOUL_REVIEWS = [
  { name: "小白的主人", rating: 5, photo: "",
    zh: "司機準時到，接送非常溫柔，途中仲影相通知我哋。每一步都講得好清楚，離開之後仍然有人跟進，好安心。",
    en: "The driver arrived on time and handled everything so gently, even sending photos along the way. Every step was explained clearly, and someone followed up afterwards. Truly reassuring." },
  { name: "Momo 的主人", rating: 5, photo: "",
    zh: "海景告別室很安靜，沒有人催促我們。我可以慢慢陪 Momo 說完最後的話，這段時間對我好重要。",
    en: "The sea-view farewell room was so quiet and no one rushed us. I could take my time to say goodbye to Momo. That time meant everything to me." },
  { name: "雪球的主人", rating: 5, photo: "",
    zh: "骨灰同掌印都處理得好細心。離別之後仲收到關懷訊息，明白我們的心情，真心多謝 RESOUL。",
    en: "The ashes and paw print were handled with such care. We even received a caring message afterwards. Heartfelt thanks to RESOUL." },
  { name: "布丁的家人", rating: 5, photo: "",
    zh: "半夜突然離開，打去熱線好快有人接聽，冷靜咁教我點樣安置。真係幫我哋渡過咗最徬徨嗰一晚。",
    en: "Our pet passed suddenly in the middle of the night. The hotline answered quickly and calmly guided us on what to do. They helped us through the most frightening night." },
  { name: "Lucky 的主人", rating: 5, photo: "",
    zh: "全程冇兜路、冇轉手，由接送到骨灰交還都係同一位同事跟進，好有信任感。",
    en: "No detours, no hand-offs — the same staff member looked after us from pick-up to returning the ashes. It built real trust." },
  { name: "咖啡的主人", rating: 5, photo: "",
    zh: "個別火化，全程有記錄，我可以親自陪住。交還嘅真係得返佢自己，我先真正放心。",
    en: "Individual cremation with a full record, and I could stay with him the whole time. Knowing what came back was only him gave me real peace of mind." },
  { name: "花生的家人", rating: 5, photo: "",
    zh: "職員好有耐性，等我哋喊完、影完相先繼續。冇一刻覺得自己係喺趕時間。",
    en: "The staff were so patient — they waited for us to cry and take photos before continuing. Not once did we feel rushed." },
  { name: "波波的主人", rating: 5, photo: "",
    zh: "第一次面對呢啲事，佢哋一步步教我點揀方案，冇任何硬銷，只係細心解釋。",
    en: "It was my first time facing this. They walked me through the options step by step — no hard selling, just patient explanation." },
  { name: "奶茶的主人", rating: 5, photo: "",
    zh: "追思相框同毛髮紀念做得好靚，擺喺屋企好似佢仲喺度咁。多謝你哋保留呢份連結。",
    en: "The memorial frame and fur keepsake were beautifully made — having them at home feels like she's still with us. Thank you for keeping that bond." },
  { name: "灰灰的家人", rating: 5, photo: "",
    zh: "由頭到尾都好透明，價錢事先講清楚，冇任何隱藏收費，令人好安心。",
    en: "Everything was transparent from start to finish — prices were explained upfront with no hidden fees. Very reassuring." },
  { name: "豆豆的主人", rating: 5, photo: "",
    zh: "本身好擔心兔仔會唔會唔接收，點知佢哋一樣好尊重咁對待，當佢係我哋屋企人。",
    en: "I worried they might not take a rabbit, but they treated him with the same respect — as one of our family." },
  { name: "Coco 的主人", rating: 5, photo: "",
    zh: "儀式後幾日收到一封慰問信，先發現原來佢哋真係記得 Coco 個名同故事。好感動。",
    en: "A few days after the ceremony we received a letter of condolence, and realised they truly remembered Coco's name and story. Deeply moving." }
];
