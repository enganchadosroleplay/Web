const express = require('express');
const session = require('express-session');
const openid = require('openid');
const axios = require('axios');
const http = require('http');
const mysql = require('mysql');
const app = express();
const util = require('util');
app.use(express.json());

app.use(session({ secret: 'tu_clave_secreta', resave: false, saveUninitialized: true }));

const relyingParty = new openid.RelyingParty(
  'http://localhost:3000/auth/steam/return', // callback URL
  null,
  true,
  false,
  []
);

const IPSERVIDORCANSEN = "31.57.96.67";
const PUERTOSERVIDORCANSEN = "3389";
const JUGADORESMAXIMOS = "48";
const HOSTSERVER = "XeroHosting";
const USUARIOSQL = "root";
const CONTRASEÑASQL = "";
const NOMBRESQL = "esxlegacy_61ffe6";

const db = mysql.createConnection({
  host: HOSTSERVER,
  user: USUARIOSQL,
  password: CONTRASEÑASQL,
  database: NOMBRESQL
});

// Promisify para usar async/await con mysql
db.query = util.promisify(db.query);

db.connect(err => {
  if (err) console.error('Error conectando a la base de datos:', err.message);
  else console.log('Conectado a la base de datos MySQL');
});

app.get('/api/server-status', async (req, res) => {
  let responded = false;

  const request = http.get({
    host: IPSERVIDORCANSEN,
    port: PUERTOSERVIDORCANSEN,
    path: '/info.json',
    timeout: 2000
  }, (response) => {
    responded = true;
    res.json({ online: response.statusCode === 200 });
  });

  request.on('error', () => {
    if (!responded) {
      responded = true;
      res.json({ online: false });
    }
  });

  request.on('timeout', () => {
    request.destroy();
    if (!responded) {
      responded = true;
      res.json({ online: false });
    }
  });
});

app.get('/api/players', async (req, res) => {
  try {
    const response = await axios.get(`http://${31.57.96.67}:${40120}/players.json`);
    const players = response.data;
    res.json({
      online: true,
      connected: players.length,
      max: JUGADORESMAXIMOS
    });
  } catch (error) {
    res.json({
      online: false,
      connected: 0,
      max: JUGADORESMAXIMOS
    });
  }
});

app.get('/api/character-name', async (req, res) => { // <--- Convertido a async
  if (!req.session.user || !req.session.user.steamid) {
    return res.json({
      name: 'Desconocido',
      mugshot: null,
      last_login: null,
      health: null,
      armor: null,
      birthdate: null,
      job: null,
      grade: null,
      money: null,
      playtime: null,
      phone: null,
      inventory: []
    });
  }

  let steamHex;
  try {
    steamHex = BigInt(req.session.user.steamid).toString(16).toLowerCase();
  } catch {
    return res.json({
      name: 'Desconocido',
      mugshot: null,
      last_login: null,
      health: null,
      armor: null,
      birthdate: null,
      job: null,
      grade: null,
      money: null,
      playtime: null,
      phone: null,
      inventory: []
    });
  }

  try {
    const userResults = await db.query('SELECT * FROM users WHERE steam_id = ?', [steamHex]);

    if (userResults.length === 0) {
      // Mismo objeto de respuesta que antes para consistencia
      return res.json({ name: 'Desconocido', mugshot: null, last_login: null, health: null, armor: null, birthdate: null, job: null, grade: null, money: null, playtime: null, phone: null, inventory: [] });
    }

    const user = userResults[0];
    const { firstname, lastname, mugshot_url, last_seen, metadata, dateofbirth, trabajo_nombre, trabajo_grado, accounts, tiempo_total, identifier, inventory } = user;

    // --- Procesamiento de datos (sin cambios) ---
    const fullName = `${firstname} ${lastname}`;
    let health = null, armor = null;
    try {
      const meta = JSON.parse(metadata || '{}');
      health = meta.health ?? null;
      armor = meta.armor ?? null;
    } catch (e) { console.error("Error parsing metadata:", e); }

    let parsedAccounts = {};
    try { parsedAccounts = JSON.parse(accounts || '{}'); } catch (e) { console.error("Error parsing accounts:", e); }

    let parsedInventory = [];
    try { parsedInventory = JSON.parse(inventory || '[]'); } catch (e) { console.error("Error parsing inventory:", e); }

    const formatDate = (rawDate) => {
      const d = new Date(rawDate);
      const pad = n => n.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const formattedLastSeen = last_seen ? formatDate(last_seen) : null;
    const formattedBirthdate = dateofbirth ? dateofbirth.split('-').reverse().join('/') : null;
    const playtime = parseInt(tiempo_total || 0, 10);

    // --- Consultas en paralelo ---
    const [phoneResults, vehicleResults, mafiasResults] = await Promise.all([
      db.query('SELECT phone_number FROM phones WHERE identifier = ?', [identifier]),
      db.query('SELECT vehicle, plate, glovebox FROM owned_vehicles WHERE owner = ?', [identifier]),
      db.query('SELECT * FROM arg_mafias')
    ]);

    const phone = (phoneResults.length > 0) ? phoneResults[0].phone_number : 'No disponible';

    const vehicles = vehicleResults.map(v => {
      let modelName = 'Desconocido';
      try {
        const parsed = JSON.parse(v.vehicle || '{}');
        if (typeof parsed.model === 'string') modelName = parsed.model;
        else if (typeof parsed.model === 'number') modelName = parsed.model.toString();
        else if (parsed.name) modelName = parsed.name;
      } catch (e) { console.error("Error parsing vehicle model:", e); }

      let gloveboxContent = [];
      try { gloveboxContent = JSON.parse(v.glovebox || '[]'); } catch (e) { console.error("Error parsing glovebox:", e); }

      return { model: modelName, plate: v.plate, data: JSON.parse(v.vehicle || '{}'), glovebox: gloveboxContent };
    });

    let mafia = null;
    for (const m of mafiasResults) {
      try {
        const metadata = JSON.parse(m.metadata || '{}');
        const members = metadata.members || {};
        if (members[identifier]) {
          mafia = {
            id: m.id, name: m.name, level: m.level, expiration_date: m.expiration_date, slots: m.slots, webhook_url: m.webhook_url,
            vehicles: metadata.vehicleList || [], rank: members[identifier].rank,
            puntos: { inventario: metadata.inventory, garage: metadata.garage, revivir: metadata.revivir, vestidor: metadata.wardobe },
            miembros: Object.values(members).map(member => ({ nombre: member.name, rango: member.rank }))
          };
          break;
        }
      } catch (e) { console.error("Error parsing mafia metadata:", e); }
    }

    let codigos = [];
    let mafiaInventory = [];
    let mafiaBossInventory = [];

    if (mafia) {
      const [codeResults, invResults] = await Promise.all([
        db.query('SELECT * FROM arg_mafia_codigos WHERE mafia_id = ?', [mafia.id]),
        db.query('SELECT name, data FROM ox_inventory WHERE name IN (?, ?)', [mafia.name, mafia.name + '_jefe'])
      ]);

      codigos = codeResults.map(code => ({ id: code.id, codigo: code.codigo, usado: code.usado === 1, usado_por: code.usado_por || null, fecha_creacion: code.fecha_creacion, rank: code.rank }));

      invResults.forEach(row => {
        try {
          const parsed = JSON.parse(row.data || '[]');
          if (row.name === mafia.name) mafiaInventory = parsed;
          else if (row.name === mafia.name + '_jefe') mafiaBossInventory = parsed;
        } catch (e) { console.error("Error parsing mafia inventory:", e); }
      });
    }

    // --- Respuesta final ---
    res.json({
      name: fullName,
      identifier,
      steam_name: req.session.user?.name || null,
      mugshot: mugshot_url,
      last_login: formattedLastSeen,
      health,
      armor,
      birthdate: formattedBirthdate,
      job: trabajo_nombre,
      grade: trabajo_grado,
      money: parsedAccounts,
      playtime,
      phone,
      inventory: parsedInventory,
      discord_id: user.discord_id,
      steam_id: user.steam_id,
      vehicles,
      mafia,
      codigos,
      mafiaInventory, // ✅ agregado aquí
      mafiaBossInventory
    });

  } catch (error) {
    console.error('Error en /api/character-name:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/api/mafia/inventory', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json([]);

  db.query('SELECT data FROM ox_inventory WHERE owner = ?', [name], (err, results) => {
    if (err || results.length === 0) return res.json([]);

    try {
      const parsed = JSON.parse(results[0].data || '[]');
      return res.json(parsed);
    } catch {
      return res.json([]);
    }
  });
});

app.post('/api/mafia/join', (req, res) => {
  const { code, identifier, steam_name } = req.body;

  if (!code || !identifier || !steam_name) {
    return res.status(400).json({ success: false, message: 'Datos incompletos' });
  }

  db.query('SELECT * FROM arg_mafia_codigos WHERE codigo = ? AND usado = 0', [code], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ success: false, message: 'Código inválido o ya usado' });
    }

    const codigo = results[0];

    db.query('SELECT * FROM arg_mafias WHERE id = ?', [codigo.mafia_id], (err2, mafiaResults) => {
      if (err2 || mafiaResults.length === 0) {
        return res.status(404).json({ success: false, message: 'Mafia no encontrada' });
      }

      let mafia = mafiaResults[0];
      let metadata;
      try {
        metadata = JSON.parse(mafia.metadata || '{}');
        metadata.members = metadata.members || {};

        // ✅ Añadir al miembro con su identifier y nombre
        metadata.members[identifier] = {
          name: steam_name,
          rank: codigo.rank || 0
        };
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Error al procesar metadata' });
      }

      db.query('UPDATE arg_mafias SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), mafia.id], (err3) => {
        if (err3) return res.status(500).json({ success: false, message: 'Error al guardar en la mafia' });

        db.query('UPDATE arg_mafia_codigos SET usado = 1, usado_por = ? WHERE id = ?', [steam_name, codigo.id], (err4) => {
          if (err4) return res.status(500).json({ success: false, message: 'Error al marcar el código como usado' });

          return res.json({ success: true });
        });
      });
    });
  });
});

app.post('/api/mafia/quit', (req, res) => {
  const { identifier, steam_name } = req.body;

  if (!identifier || !steam_name) {
    return res.status(400).json({ success: false, message: 'Datos faltantes' });
  }

  db.query('SELECT * FROM arg_mafias', (err, mafias) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al buscar mafias' });

    for (const mafia of mafias) {
      try {
        const metadata = JSON.parse(mafia.metadata || '{}');
        const members = metadata.members || {};

        // Verificar si el usuario está en la mafia
        if (Object.hasOwn(members, identifier)) {
          delete members[identifier]; // ✅ ELIMINA del objeto por identifier
          metadata.members = members;

          // Actualizar metadata sin el miembro
          db.query('UPDATE arg_mafias SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), mafia.id], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Error al actualizar mafia' });

            // Eliminar código si coincide con steam_name
            db.query(
              'DELETE FROM arg_mafia_codigos WHERE mafia_id = ? AND usado_por = ?',
              [mafia.id, steam_name],
              (err3) => {
                if (err3) return res.status(500).json({ success: false, message: 'Error al borrar código usado' });
                return res.json({ success: true });
              }
            );
          });

          return;
        }
      } catch (e) {}
    }

    return res.status(404).json({ success: false, message: 'No pertenecés a ninguna mafia' });
  });
});

app.post('/api/delete-mafia-code', (req, res) => {
  const { identifier, codeId } = req.body;

  if (!identifier || !codeId) {
    return res.status(400).json({ success: false, message: 'Datos faltantes' });
  }

  db.query('SELECT * FROM arg_mafias', (err, mafias) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al buscar mafias' });

    for (const mafia of mafias) {
      try {
        const meta = JSON.parse(mafia.metadata || '{}');
        const members = meta.members || {};

        if (members[identifier] && members[identifier].rank === 1) {
          // Verifica si el código existe y no fue usado
          db.query('SELECT * FROM arg_mafia_codigos WHERE id = ? AND mafia_id = ?', [codeId, mafia.id], (err2, results) => {
            if (err2 || results.length === 0) {
              return res.status(404).json({ success: false, message: 'Código no encontrado' });
            }

            const code = results[0];
            if (code.usado === 1) {
              return res.status(400).json({ success: false, message: 'El código ya fue usado y no se puede borrar' });
            }

            db.query('DELETE FROM arg_mafia_codigos WHERE id = ?', [codeId], (err3) => {
              if (err3) return res.status(500).json({ success: false, message: 'Error al eliminar código' });
              return res.json({ success: true });
            });
          });
          return;
        }
      } catch {}
    }

    return res.status(403).json({ success: false, message: 'No autorizado' });
  });
});

const generateRandomCode = () => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return `MAFIA-${suffix}`;
};

app.post('/api/generate-mafia-codes', (req, res) => {
  const { identifier, cantidad } = req.body;

  if (!identifier || !cantidad || cantidad < 1 || cantidad > 5) {
    return res.status(400).json({ success: false, message: 'Parámetros inválidos' });
  }

  db.query('SELECT * FROM arg_mafias', (err, mafias) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al buscar mafia' });

    for (const mafia of mafias) {
      try {
        const meta = JSON.parse(mafia.metadata || '{}');
        const members = meta.members || {};

        if (members[identifier] && members[identifier].rank === 1) {
          db.query('SELECT COUNT(*) AS total FROM arg_mafia_codigos WHERE mafia_id = ?', [mafia.id], (err2, results) => {
            const totalActual = results[0].total;
            const disponibles = mafia.slots - totalActual;

            if (cantidad > disponibles) {
              return res.status(400).json({ success: false, message: `Solo hay ${disponibles} slot(s) disponibles.` });
            }

            const insertCodes = () => {
              const insertPromises = [];

              for (let i = 0; i < cantidad; i++) {
                let nuevoCodigo;

                const generarUnico = async () => {
                  let existe = true;
                  while (existe) {
                    nuevoCodigo = generateRandomCode();
                    const [check] = await new Promise((resolve, reject) => {
                      db.query('SELECT 1 FROM arg_mafia_codigos WHERE codigo = ?', [nuevoCodigo], (err, res) => {
                        if (err) reject(err);
                        else resolve(res);
                      });
                    });
                    existe = !!check;
                  }

                  return new Promise((resolve, reject) => {
                    db.query(
                      'INSERT INTO arg_mafia_codigos (mafia_id, codigo, rank) VALUES (?, ?, ?)',
                      [mafia.id, nuevoCodigo, 0],
                      (err3) => {
                        if (err3) reject(err3);
                        else resolve();
                      }
                    );
                  });
                };

                insertPromises.push(generarUnico());
              }

              Promise.all(insertPromises)
                .then(() => res.json({ success: true }))
                .catch(() => res.status(500).json({ success: false, message: 'Error generando códigos' }));
            };

            insertCodes();
          });

          return;
        }
      } catch {}
    }

    return res.status(403).json({ success: false, message: 'No autorizado o no es jefe' });
  });
});

app.post('/api/update-webhook', (req, res) => {
  const { identifier, newWebhook } = req.body;

  console.log('[Webhook POST] ID:', identifier);
  console.log('[Webhook POST] URL:', newWebhook);

  if (!identifier || !newWebhook) {
    return res.status(400).json({ success: false, message: 'Datos faltantes' });
  }

  db.query('SELECT * FROM arg_mafias', (err, mafias) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al buscar mafia' });

    for (const mafia of mafias) {
      try {
        const meta = JSON.parse(mafia.metadata || '{}');
        const members = meta.members || {};

        console.log(`[Mafia: ${mafia.name}] Identificadores:`, Object.keys(members));

        if (members[identifier] && members[identifier].rank === 1) {
          db.query(
            'UPDATE arg_mafias SET webhook_url = ? WHERE id = ?',
            [newWebhook, mafia.id],
            (err2) => {
              if (err2) {
                console.error('[DB Error]', err2);
                return res.status(500).json({ success: false, message: 'Error al actualizar webhook' });
              }

              console.log(`[✔] Webhook actualizado para mafia ID ${mafia.id}`);
              return res.json({ success: true });
            }
          );
          return;
        }
      } catch (parseErr) {
        console.error('[Parse Error]', parseErr);
      }
    }

    return res.status(403).json({ success: false, message: 'No autorizado o no es jefe' });
  });
});

const testedWebhooks = new Map(); // clave: identifier, valor: timestamp

app.post('/api/test-webhook', (req, res) => {
  const { identifier, webhook_url } = req.body;

  if (!identifier || !webhook_url) {
    return res.status(400).json({ success: false, message: 'Datos faltantes' });
  }

  const now = Date.now();
  const lastTest = testedWebhooks.get(identifier);

  // Si ya lo usó hace menos de 24h
  if (lastTest && now - lastTest < 24 * 60 * 60 * 1000) {
    return res.status(429).json({ success: false, message: 'Ya se ha usado hoy. Intenta mañana.' });
  }

  // Enviar mensaje al webhook
  const axios = require('axios');
  axios.post(webhook_url, {
    embeds: [{
      title: '🔧 Test de Webhook Exitoso',
      description: `Este mensaje confirma que el webhook está funcionando correctamente.`,
      color: 3066993,
      timestamp: new Date().toISOString(),
      footer: { text: 'Sistema de Mafias - Test Webhook' }
    }]
  }).then(() => {
    testedWebhooks.set(identifier, now);
    res.json({ success: true });
  }).catch(err => {
    console.error('[Webhook Error]', err);
    res.status(500).json({ success: false, message: 'Error al enviar al webhook.' });
  });
});

app.post('/api/kick-mafia-member', (req, res) => {
  const { identifier, memberName } = req.body;

  if (!identifier || !memberName) {
    return res.status(400).json({ success: false, message: 'Datos faltantes' });
  }

  db.query('SELECT * FROM arg_mafias', (err, mafias) => {
    if (err) return res.status(500).json({ success: false, message: 'Error al buscar mafias' });

    for (const mafia of mafias) {
      try {
        const meta = JSON.parse(mafia.metadata || '{}');
        const members = meta.members || {};

        // Buscar si el jefe actual pertenece a esta mafia y tiene rango 1
        if (members[identifier] && members[identifier].rank === 1) {
          // Buscar al miembro a expulsar por nombre
          const targetKey = Object.keys(members).find(key => members[key].name === memberName);

          if (!targetKey) {
            return res.status(404).json({ success: false, message: 'Miembro no encontrado en la mafia.' });
          }

          if (members[targetKey].rank === 1) {
            return res.status(403).json({ success: false, message: 'No se puede expulsar a otro jefe.' });
          }

          delete members[targetKey]; // expulsar

          // Guardar cambios en la base de datos
          meta.members = members;
          const updatedMetadata = JSON.stringify(meta);

          db.query('UPDATE arg_mafias SET metadata = ? WHERE id = ?', [updatedMetadata, mafia.id], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Error al guardar cambios' });
            return res.json({ success: true });
          });

          return; // salir del loop
        }

      } catch (e) {
        console.error('[Kick Mafia Member]', e);
        return res.status(500).json({ success: false, message: 'Error interno' });
      }
    }

    return res.status(403).json({ success: false, message: 'No autorizado o no pertenece a una mafia' });
  });
});

app.get('/auth/steam', (req, res) => {
  relyingParty.authenticate('http://steamcommunity.com/openid', false, (error, authUrl) => {
    if (error || !authUrl) return res.send('Error de autenticación Steam.');
    res.redirect(authUrl);
  });
});

app.get('/auth/steam/return', (req, res) => {
  relyingParty.verifyAssertion(req, async (error, result) => {
    if (!result || !result.authenticated) return res.redirect('/inicio');
    const steamId = result.claimedIdentifier.split('/').pop();

    try {
      const response = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=05463436B448108C0A45A3A2FB429940&steamids=${steamId}`);
      const player = response.data.response.players[0];

      req.session.user = {
        name: player.personaname,
        avatar: player.avatarfull,
        steamid: steamId // Guardamos el SteamID64
      };

      const webhookUrl = 'https://discord.com/api/webhooks/1369468548900196433/QWhZqMuquBuchvmCJxuvvbU7h9XBXxBaCRI4MZIKmVFmOoYgaqoSEqWUtMndjWoCatCt';
      const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

      await axios.post(webhookUrl, {
        embeds: [{
          title: '🟢 Nuevo inicio de sesión en la web',
          color: 65280,
          thumbnail: { url: player.avatarfull },
          fields: [
            { name: '👤 Usuario Steam', value: player.personaname, inline: true },
            { name: '🕐 Fecha', value: fecha, inline: true },
            { name: '🆔 SteamID', value: steamId, inline: false }
          ],
          footer: { text: 'Enganchados RP - Autenticación Steam' },
          timestamp: new Date().toISOString()
        }]
      });

      res.redirect('/inicio');
    } catch (err) {
      res.send('Error al obtener perfil Steam');
    }
  });
});

app.get('/session', (req, res) => {
  res.json(req.session.user || {});
});

app.get('/', (req, res) => {
  res.redirect('/inicio');
});

app.get('/logout', async (req, res) => {
  const user = req.session.user;

  if (user) {
    const webhookUrl = 'https://discord.com/api/webhooks/1369469188879683604/3_5h0AlhzOMwrIXBuWohey6MP2iVUzHxrs32RKJM37Dh1NEznmqzzOJpfvj_xkKBnVbb';
    const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    try {
      await axios.post(webhookUrl, {
        embeds: [{
          title: '🔴 Cierre de sesión en la web',
          color: 16711680,
          thumbnail: { url: user.avatar },
          fields: [
            { name: '👤 Usuario Steam', value: user.name, inline: true },
            { name: '🕐 Fecha', value: fecha, inline: true }
          ],
          footer: { text: 'Enganchados RP - Cierre de sesión' },
          timestamp: new Date().toISOString()
        }]
      });
    } catch (err) {
      console.error('Error enviando webhook de salida:', err.message);
    }
  }

  req.session.destroy(() => res.redirect('/'));
});

app.get('/panel', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/steam');
  res.sendFile(__dirname + '/public/panel/index.html');
});

app.get('/panel/roleplay', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/steam');
  res.sendFile(__dirname + '/public/panel/roleplay.html');
});

app.get('/normativas/', (req, res) => {
  res.sendFile(__dirname + '/public/normativas/index.html');
});

app.use(express.static('public'));

app.listen(3000, () => console.log('Servidor en http://localhost:3000'));