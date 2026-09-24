// Calendar writes now happen inside /api/booking after a validated,
// rate-limited booking has been stored. Keep the legacy route closed.
const { requireAllowedOrigin } = require("./_security");

module.exports = async (req, res) => {
  if (!requireAllowedOrigin(req, res)) return;
  res.status(410).json({ error: "use_booking_endpoint" });
};
