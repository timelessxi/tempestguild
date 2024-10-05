const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next(); // User is authenticated, proceed
    }
    res.redirect('/login'); // Redirect to login if not authenticated
};

// Middleware to check for admin or guild master roles
const isAdminOrGuildMaster = (req, res, next) => {
    if (req.session && (req.session.role === 1 || req.session.role === 2)) {
        return next(); // User has admin or guild master role, proceed
    }
    res.status(403).send('Access denied'); // Access denied for non-admins/non-guild masters
};

module.exports = {
    isAuthenticated,
    isAdminOrGuildMaster,
};

