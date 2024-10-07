const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const fs = require('fs');
const multer = require('multer');
const db = require('../config/db');
const { extractBankItemsFromLuaString, extractCharactersFromLuaString } = require('../utils/luaParser');
const { moveCharacterToUser } = require('../utils/characterUtils');
const { isAuthenticated, isAdminOrGuildMaster } = require('./middleware');

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// Home page
router.get('/', (req, res) => {
    res.render('base', { title: 'Home - Tempest Guild', page: 'home' });
});

// Admin dashboard
router.get('/admin', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        const [pendingUsers] = await db.query('SELECT * FROM users WHERE status = ?', ['pending']);
        const [roles] = await db.query('SELECT * FROM roles');
        const [itemRequests] = await db.query(`
            SELECT ir.id, u.username, c.name AS character_name, gb.name AS item_name, ir.quantity, ir.status
            FROM item_requests ir
            JOIN users u ON ir.user_id = u.id
            JOIN characters c ON ir.character_id = c.id
            JOIN guild_bank gb ON ir.item_id = gb.id
            WHERE ir.status = 'pending'
        `);
        const [users] = await db.query(`
            SELECT u.id AS user_id, u.username, u.email, u.status, r.name AS role,
                   GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS characters,
                   GROUP_CONCAT(DISTINCT p.name SEPARATOR ', ') AS professions
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            LEFT JOIN characters c ON c.user_id = u.id
            LEFT JOIN character_professions cp ON cp.character_id = c.id
            LEFT JOIN professions p ON p.id = cp.profession_id
            GROUP BY u.id
        `);
        const [events] = await db.query('SELECT * FROM events ORDER BY event_date ASC');

        res.render('base', {
            title: 'Admin - Tempest Guild',
            page: 'admin',
            newsArticles,
            pendingUsers,
            roles,
            itemRequests,
            users,
            events
        });
    } catch (error) {
        console.error('Error fetching admin data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// News routes
router.get('/news', async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        res.render('base', { title: 'Guild News', page: 'news', newsArticles, user: req.user });
    } catch (error) {
        console.error('Error fetching news articles:', error);
        res.status(500).send('Internal Server Error');
    }
});

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

router.post('/admin/news/delete/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const articleId = req.params.id;
    try {
        await db.query('DELETE FROM news_articles WHERE id = ?', [articleId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error deleting article:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/admin/users/approve/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const userId = req.params.id;
    const { role_id } = req.body;

    try {
        // Get the user to be approved
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(400).send('User not found');
        }

        const claimedCharacterName = user[0].main_character;

        if (claimedCharacterName) {
            // Check if the main character is already claimed by another user
            const [character] = await db.query('SELECT * FROM characters WHERE name = ? AND status = "claimed"', [claimedCharacterName]);
            if (character.length > 0) {
                return res.status(400).send(`Character '${claimedCharacterName}' is already claimed by another user. Approval not allowed.`);
            }

            // Update the character status to claimed and associate it with the user
            await db.query('UPDATE characters SET status = "claimed", user_id = ? WHERE name = ?', [userId, claimedCharacterName]);
        }

        // Update user status to approved and set the role
        await db.query('UPDATE users SET status = ?, role_id = ? WHERE id = ?', ['approved', role_id, userId]);
        
        res.redirect('/admin');
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).send('Internal Server Error');
    }
});


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

// Item request management routes
router.post('/admin/request/approve/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const requestId = req.params.id;
    try {
        const [request] = await db.query(`
            SELECT ir.item_id, ir.quantity
            FROM item_requests ir
            WHERE ir.id = ?
        `, [requestId]);

        if (request.length === 0) {
            return res.status(404).send('Request not found');
        }

        await db.query('UPDATE item_requests SET status = ? WHERE id = ?', ['approved', requestId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error approving request:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/admin/request/deny/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const requestId = req.params.id;
    try {
        await db.query('UPDATE item_requests SET status = ? WHERE id = ?', ['denied', requestId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error denying request:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Roster file upload route
router.post('/upload-roster', isAuthenticated, isAdminOrGuildMaster, upload.single('rosterFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;

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

            const [existingCharacters] = await db.query('SELECT id, user_id, guild_id, name, class, level FROM characters');
            const existingCharacterNames = existingCharacters.map(character => character.name);

            const updatePromises = characters.map(async character => {
                if (existingCharacterNames.includes(character.name)) {
                    const existingCharacter = existingCharacters.find(c => c.name === character.name);
                    if (existingCharacter.level !== character.level) {
                        await db.query('UPDATE characters SET level = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?', [character.level, character.name]);
                    }
                } else {
                    await db.query('INSERT INTO characters (name, class, level, guild_id, status) VALUES (?, ?, ?, ?, ?)', [
                        character.name,
                        character.class,
                        character.level,
                        1,
                        'unclaimed'
                    ]);
                }
            });

            await Promise.all(updatePromises);

            const uploadedCharacterNames = characters.map(character => character.name);
            const charactersToRemove = existingCharacters.filter(c => !uploadedCharacterNames.includes(c.name));

            const removePromises = charactersToRemove.map(async character => {
                await db.query('INSERT INTO dead_characters (name, class, level, user_id, guild_id) VALUES (?, ?, ?, ?, ?)', [
                    character.name,
                    character.class,
                    character.level,
                    character.user_id || null,
                    character.guild_id || 1
                ]);
                await db.query('DELETE FROM characters WHERE name = ?', [character.name]);
            });

            await Promise.all(removePromises);

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

// Guild bank file upload route
router.post('/upload-bank', isAuthenticated, isAdminOrGuildMaster, upload.single('bankFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;

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

            const [existingItems] = await db.query('SELECT * FROM guild_bank');
            const existingItemsMap = new Map(existingItems.map(item => [item.name, item]));

            const upsertPromises = items.map(async newItem => {
                const existingItem = existingItemsMap.get(newItem.name);

                if (existingItem) {
                    if (newItem.count !== existingItem.count ||
                        newItem.type !== existingItem.type ||
                        newItem.rarity !== existingItem.rarity ||
                        newItem.subType !== existingItem.subType ||
                        newItem.stats !== existingItem.stats) {
                        await db.query(
                            'UPDATE guild_bank SET count = ?, type = ?, rarity = ?, subType = ?, stats = ? WHERE id = ?',
                            [newItem.count, newItem.type, newItem.rarity, newItem.subType || null, newItem.stats || null, existingItem.id]
                        );
                    }
                    existingItemsMap.delete(newItem.name);
                } else {
                    await db.query(
                        'INSERT INTO guild_bank (name, type, count, rarity, subType, stats, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [newItem.name, newItem.type, newItem.count, newItem.rarity, newItem.subType || null, newItem.stats || null, newItem.source || null]
                    );
                }
            });

            const deletePromises = Array.from(existingItemsMap.values()).map(async oldItem => {
                await db.query('DELETE FROM guild_bank WHERE id = ?', [oldItem.id]);
            });

            await Promise.all([...upsertPromises, ...deletePromises]);

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

// Roster page
router.get('/roster', isAuthenticated, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                c.id AS character_id, 
                c.name AS character_name, 
                c.class, 
                c.level, 
                c.status,
                u.id AS user_id, 
                u.username, 
                u.profile_image,
                p.name AS profession_name, 
                cp.profession_level
            FROM 
                characters c
            LEFT JOIN 
                users u ON c.user_id = u.id
            LEFT JOIN 
                character_professions cp ON cp.character_id = c.id
            LEFT JOIN 
                professions p ON cp.profession_id = p.id
            ORDER BY 
                c.name;
        `);

        const characters = {};
        rows.forEach(row => {
            if (!characters[row.character_id]) {
                characters[row.character_id] = {
                    id: row.character_id,
                    name: row.character_name,
                    class: row.class,
                    level: row.level,
                    status: row.status,
                    professions: [],
                    user: null
                };
            }

            if (row.user_id) {
                characters[row.character_id].user = {
                    id: row.user_id,
                    username: row.username,
                    profile_image: row.profile_image
                };
            }

            if (row.profession_name) {
                characters[row.character_id].professions.push({
                    name: row.profession_name,
                    level: row.profession_level
                });
            }
        });

        const characterList = Object.values(characters);

        res.render('base', {
            title: 'Guild Roster - Tempest Guild',
            page: 'roster',
            characters: characterList
        });
    } catch (error) {
        console.error('Error fetching roster:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Guild bank page
router.get('/bank', isAuthenticated, async (req, res) => {
    try {
        const [allItems] = await db.query(`
            SELECT gb.*, 
                   IFNULL(SUM(CASE WHEN ir.status = 'pending' THEN ir.quantity ELSE 0 END), 0) AS pending_quantity
            FROM guild_bank gb
            LEFT JOIN item_requests ir ON gb.id = ir.item_id
            GROUP BY gb.id
        `);
        const [claimedCharacters] = await db.query('SELECT id, name FROM characters WHERE status = ?', ['claimed']);

        const rarityMap = {
            1: { name: 'Common', class: 'rarity-common' },
            2: { name: 'Uncommon', class: 'rarity-uncommon' },
            3: { name: 'Rare', class: 'rarity-rare' },
            4: { name: 'Epic', class: 'rarity-epic' },
            5: { name: 'Legendary', class: 'rarity-legendary' }
        };

        allItems.forEach(item => {
            item.rarity_name = rarityMap[item.rarity]?.name || 'Unknown';
            item.rarity_class = rarityMap[item.rarity]?.class || '';
            item.adjusted_stock = item.count - item.pending_quantity;
        });

        const weaponItems = allItems.filter(item => item.type === 'Weapon');
        const armorItems = allItems.filter(item => item.type === 'Armor');
        const consumableItems = allItems.filter(item => item.type === 'Consumable');
        const materialItems = allItems.filter(item => item.type === 'Trade Goods');
        const recipeItems = allItems.filter(item => item.type === 'Recipe');
        const bagItems = allItems.filter(item => item.type === 'Container');

        res.render('base', {
            title: 'Guild Bank - Tempest Guild',
            page: 'bank',
            allItems,
            weaponItems,
            armorItems,
            consumableItems,
            materialItems,
            recipeItems,
            bagItems,
            claimedCharacters
        });
    } catch (error) {
        console.error('Error fetching guild bank data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Item request
router.post('/request-item', isAuthenticated, async (req, res) => {
    const { item_id, character_id, quantity } = req.body;
    const user_id = req.session.userId;

    try {
        const [item] = await db.query(`
            SELECT gb.*, 
                   IFNULL(SUM(CASE WHEN ir.status = 'pending' THEN ir.quantity ELSE 0 END), 0) AS pending_quantity
            FROM guild_bank gb
            LEFT JOIN item_requests ir ON gb.id = ir.item_id
            WHERE gb.id = ?
            GROUP BY gb.id
        `, [item_id]);

        if (!item || item.length === 0) {
            req.flash('error', 'Item not found.');
            return res.redirect('/bank');
        }

        const adjusted_stock = item[0].count - item[0].pending_quantity;
        if (quantity > adjusted_stock) {
            req.flash('error', 'Request exceeds available stock.');
            return res.redirect('/bank');
        }

        await db.query('INSERT INTO item_requests (user_id, character_id, item_id, quantity) VALUES (?, ?, ?, ?)', [
            user_id,
            character_id,
            item_id,
            quantity
        ]);

        req.flash('success', 'Item request submitted successfully.');
        res.redirect('/bank');
    } catch (error) {
        console.error('Error submitting item request:', error);
        req.flash('error', 'An error occurred while submitting your request.');
        res.redirect('/bank');
    }
});

// Character claiming
router.post('/claim-character/:id', isAuthenticated, async (req, res) => {
    const characterId = req.params.id;
    const userId = req.session.userId;

    try {
        const moveResult = await moveCharacterToUser(userId, characterId);
        if (!moveResult.success) {
            return res.status(400).json({ success: false, message: moveResult.message });
        }

        res.status(200).json({ success: true, message: 'Character claimed successfully!' });
    } catch (error) {
        console.error('Error claiming character:', error);
        res.status(500).json({ success: false, message: 'An error occurred while claiming the character.' });
    }
});

// Event routes
router.get('/events', async (req, res) => {
    try {
        const [events] = await db.query(`
            SELECT e.id, e.title, e.content, e.event_date AS start, u.username AS created_by
            FROM events e
            JOIN users u ON e.created_by = u.id
        `);

        const formattedEvents = events.map(event => ({
            id: event.id,
            title: event.title,
            start: event.start,
            extendedProps: {
                content: event.content,
                created_by: event.created_by
            }
        }));

        res.json(formattedEvents);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ success: false, message: 'Error fetching events' });
    }
});

router.post('/events', isAuthenticated, async (req, res) => {
    const { title, event_date, content } = req.body;
    const created_by = req.session.userId;

    try {
        const [result] = await db.query('INSERT INTO events (title, content, event_date, created_by) VALUES (?, ?, ?, ?)', [title, content, event_date, created_by]);
        const newEvent = {
            id: result.insertId,
            title: title,
            date: event_date,
            content: content
        };
        res.status(201).json({ success: true, event: newEvent });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ success: false, message: 'Error creating event' });
    }
});

router.post('/admin/events/add', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const { title, content, event_date } = req.body;
    try {
        await db.query('INSERT INTO events (title, content, event_date, created_at) VALUES (?, ?, ?, NOW())', [title, content, event_date]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/admin/events/edit/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const { title, content, event_date } = req.body;
    const eventId = req.params.id;
    try {
        await db.query('UPDATE events SET title = ?, content = ?, event_date = ?, updated_at = NOW() WHERE id = ?', [title, content, event_date, eventId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/admin/events/delete/:id', isAuthenticated, isAdminOrGuildMaster, async (req, res) => {
    const eventId = req.params.id;
    try {
        await db.query('DELETE FROM events WHERE id = ?', [eventId]);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Contact page
router.get('/contact', (req, res) => {
    res.render('base', { title: 'Contact Us - Tempest Guild', page: 'contact' });
});

module.exports = router;
