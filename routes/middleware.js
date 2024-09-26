// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next(); // Continue if user is authenticated
    } else {
        res.redirect('/login'); // Redirect to login if not authenticated
    }
}

// Middleware to ensure user is an admin
function ensureAdmin(req, res, next) {
    if (req.session && req.session.role === 1) { // Assuming role_id 1 is for admin
        return next(); // Continue if user is an admin
    } else {
        res.status(403).send('Access denied'); // Show access denied for non-admins
    }
}

module.exports = { ensureAuthenticated, ensureAdmin };
