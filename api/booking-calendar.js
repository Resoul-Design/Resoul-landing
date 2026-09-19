// Calendar writes now happen inside /api/booking after a validated,
// rate-limited booking has been stored. Keep the legacy route closed.
module.exports = async (_req, res) => {
  res.status(410).json({ error: "use_booking_endpoint" });
};
