'use strict';
const crypto = require('node:crypto');

const SESSION_HOURS = 12;

function hashPassword(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(senha, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(senha), salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

function createSession(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare("DELETE FROM sessoes WHERE expira_em < ?").run(new Date().toISOString());
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, usuarioId, expira);
  return token;
}

function authMiddleware(db) {
  const stmt = db.prepare(`
    SELECT u.id, u.nome, u.email, u.perfil FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira_em > ? AND u.ativo = 1`);
  return (req, res, next) => {
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const user = token && stmt.get(token, new Date().toISOString());
    if (!user) return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
    req.user = { ...user };
    req.token = token;
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, authMiddleware, requireAdmin };
