function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  // Untuk request API, balas JSON 401. Untuk request halaman, redirect ke /login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Belum login' });
  }
  return res.redirect('/login');
}

module.exports = { requireAuth };
