/**
 * Vercel a veces no parsea req.body en funciones Node; leemos el stream si hace falta.
 */
module.exports = function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) {
      try {
        return resolve(JSON.parse(req.body.toString('utf8') || '{}'));
      } catch (e) {
        return reject(e);
      }
    }
    if (req.body != null && typeof req.body === 'object') {
      return resolve(req.body);
    }
    if (typeof req.body === 'string') {
      try {
        return resolve(JSON.parse(req.body || '{}'));
      } catch (e) {
        return reject(e);
      }
    }
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
};
