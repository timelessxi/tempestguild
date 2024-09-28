const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const fs = require('fs');
const multer = require('multer');
const db = require('../config/db');
const { extractBankItemsFromLuaString, extractCharactersFromLuaString } = require('../utils/luaParser');
const { moveCharacterToUser } = require('../utils/characterUtils');

// File upload destination
const upload = multer({ dest: 'uploads/' });

// Middleware to check if the user is authenticated
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

// Home page route
router.get('/', (req, res) => {
    res.render('base', { title: 'Home - Tempest Guild', page: 'home' });
});

// Admin dashboard route (restricted to Admin and GuildMaster roles)
router.get('/admin', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        const [pendingUsers] = await db.query('SELECT * FROM users WHERE status = ?', ['pending']);

        res.render('base', { title: 'Admin - Tempest Guild', page: 'admin', body: 'admin', newsArticles, pendingUsers });
    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// News page route
router.get('/news', async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        res.render('base', { title: 'Guild News', page: 'news', newsArticles });
    } catch (error) {
        console.error('Error fetching news articles:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Add news article (admin)
router.post('/admin/news/add', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const { title, content } = req.body;
    try {
        await db.query('INSERT INTO news_articles (title, content) VALUES (?, ?)', [title, content]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error adding news article:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Edit news article (admin)
router.post('/admin/news/edit/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const { title, content } = req.body;
    const articleId = req.params.id;
    try {
        await db.query('UPDATE news_articles SET title = ?, content = ? WHERE id = ?', [title, content, articleId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error updating news article:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/admin/users/approve/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const userId = req.params.id;

    try {
        // Fetch the user and their claimed character
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user || user.length === 0) {
            return res.status(400).send('User not found');
        }

        const claimedCharacter = user[0].claimed_character_name;

        if (claimedCharacter) {
            // Claim the character using the reusable function
            const moveResult = await moveCharacterToUser(userId, claimedCharacter);
            if (!moveResult.success) {
                return res.status(400).send(moveResult.message); // Handle errors related to moving the character
            }
        }

        // Approve the user and update their status
        await db.query('UPDATE users SET status = ?, claimed_character_name = NULL WHERE id = ?', ['approved', userId]);

        res.redirect('/admin');
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Deny user (admin)
router.post('/admin/users/deny/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const userId = req.params.id;
    try {
        await db.query('UPDATE users SET status = ? WHERE id = ?', ['denied', userId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error denying user:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/upload-roster', isAuthenticated, isAdminOrGuildMaster, upload.single('rosterFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;

    // Read and process the roster Lua file
    fs.readFile(filePath, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return res.status(500).send('Error reading file.');
        }

        try {
            const characters = extractCharactersFromLuaString(data);

            if (characters.length === 0) {
                return res.status(400).send('No characters found in the file.');
            }

            // Fetch all unclaimed characters from the database
            const [existingCharacters] = await db.query('SELECT id, user_id, guild_id, name, class, level FROM characters WHERE status = "unclaimed"');
            const existingCharacterNames = existingCharacters.map(character => character.name);

            // Update or Insert Characters
            const updatePromises = characters.map(async character => {
                if (existingCharacterNames.includes(character.name)) {
                    // Character exists, update level if necessary
                    const existingCharacter = existingCharacters.find(c => c.name === character.name);
                    if (existingCharacter.level !== character.level) {
                        await db.query('UPDATE characters SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?', [character.level, character.name]);
                        console.log(`Updated character ${character.name} to level ${character.level}`);
                    }
                } else {
                    // Character does not exist, insert new
                    await db.query('INSERT INTO characters (name, class, level, guild_id, status) VALUES (?, ?, ?, ?, ?)', [
                        character.name,
                        character.class,
                        character.level,
                        1,  // Assuming guild_id is 1
                        'unclaimed'
                    ]);
                    console.log(`Inserted new character ${character.name}`);
                }
            });

            await Promise.all(updatePromises);

            // Move characters that are no longer in the upload file to the dead_characters table
            const uploadedCharacterNames = characters.map(character => character.name);
            const charactersToRemove = existingCharacters.filter(c => !uploadedCharacterNames.includes(c.name));

            const removePromises = charactersToRemove.map(async character => {
                // Move to dead_characters table with user_id and guild_id if the character was claimed
                await db.query('INSERT INTO dead_characters (name, class, level, user_id, guild_id) VALUES (?, ?, ?, ?, ?)', [
                    character.name,
                    character.class,
                    character.level,
                    character.user_id || null, // Store user_id if it was claimed
                    character.guild_id || 1    // Assuming guild_id is 1 by default
                ]);

                // Remove from characters table
                await db.query('DELETE FROM characters WHERE name = ?', [character.name]);

                console.log(`Moved character ${character.name} to dead_characters table`);
            });

            await Promise.all(removePromises);

            console.log('Guild Roster updated successfully');
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting file:', err);
                    return res.status(500).send('Error deleting file.');
                }
                res.redirect('/admin');
            });

        } catch (parseError) {
            console.error('Error parsing Lua file:', parseError);
            res.status(500).send('Error parsing Lua file.');
        }
    });
});

// Upload guild bank data route
router.post('/upload-bank', isAuthenticated, isAdminOrGuildMaster, upload.single('bankFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;

    // Read and process the bank Lua file
    fs.readFile(filePath, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return res.status(500).send('Error reading file.');
        }

        try {
            const items = extractBankItemsFromLuaString(data);

            if (items.length === 0) {
                return res.status(400).send('No items found in the file.');
            }

            // Clear the guild_bank table
            await db.query('TRUNCATE TABLE guild_bank');

            // Insert new items into the database
            const insertPromises = items.map(item => {
                if (!item.name || !item.type || !item.count || !item.rarity) {
                    console.error(`Skipping item due to missing required fields: ${JSON.stringify(item)}`);
                    return Promise.resolve();
                }
                return db.query(
                    'INSERT INTO guild_bank (name, type, count, rarity, subType, stats, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [item.name, item.type, item.count, item.rarity, item.subType || null, item.stats || null, item.source || null]
                );
            });

            await Promise.all(insertPromises);

            console.log('Guild Bank updated successfully');
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting file:', err);
                    return res.status(500).send('Error deleting file.');
                }
                res.redirect('/admin');
            });
        } catch (parseError) {
            console.error('Error parsing Lua file:', parseError);
            return res.status(500).send('Error parsing Lua file.');
        }
    });
});

// Guild roster page route
router.get('/roster', isAuthenticated, async (req, res) => {
    try {
        // Fetch claimed characters (those with a user_id)
        const [claimedCharacters] = await db.query(`
            SELECT c.name, c.class, c.level, u.username
            FROM characters c
            JOIN users u ON c.user_id = u.id
            WHERE c.status = 'claimed'
        `);

        // Fetch unclaimed characters (those without a user_id)
        const [unclaimedCharacters] = await db.query(`
            SELECT name, class, level 
            FROM characters 
            WHERE status = 'unclaimed'
        `);

        // Render the roster page with claimed and unclaimed characters
        res.render('base', {
            title: 'Guild Roster - Tempest Guild',
            page: 'roster',
            claimedCharacters,
            unclaimedCharacters,
        });
    } catch (error) {
        console.error('Error fetching roster:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Guild bank page route
router.get('/bank', isAuthenticated, async (req, res) => {
    try {
        const [allItems] = await db.query('SELECT * FROM guild_bank');

        // Map rarity numbers to names and CSS classes
        const rarityMap = {
            1: { name: 'Common', class: 'rarity-common' },
            2: { name: 'Uncommon', class: 'rarity-uncommon' },
            3: { name: 'Rare', class: 'rarity-rare' },
            4: { name: 'Epic', class: 'rarity-epic' },
            5: { name: 'Legendary', class: 'rarity-legendary' },
        };

        allItems.forEach(item => {
            item.rarity_name = rarityMap[item.rarity]?.name || 'Unknown';
            item.rarity_class = rarityMap[item.rarity]?.class || '';
        });

        // Categorize items for the tabs
        const weaponItems = allItems.filter(item => item.type === 'Weapon');
        const armorItems = allItems.filter(item => item.type === 'Armor');
        const consumableItems = allItems.filter(item => item.type === 'Consumable');
        const materialItems = allItems.filter(item => item.type === 'Trade Goods');
        const bagItems = allItems.filter(item => item.type === 'Container');

        res.render('base', {
            title: 'Guild Bank - Tempest Guild',
            page: 'bank',
            allItems,
            weaponItems,
            armorItems,
            consumableItems,
            materialItems,
            bagItems,
        });
    } catch (error) {
        console.error('Error fetching guild bank data:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/contact', (req, res) => {
    res.render('base', { title: 'Contact Us - Tempest Guild', page: 'contact' });
});

module.exports = router;
