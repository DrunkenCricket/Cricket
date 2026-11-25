// Signed Locker Room keys, shared by the Discord commands, the website and the live Herd.
// Signed, expiring locker links: uid.expiry.signature (HMAC with a Worker secret, so nobody can forge one).
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(env, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("locker:" + env.DISCORD_BOT_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
export async function lockerToken(env, uid, hours = 2) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `${uid}.${exp}.${await hmac(env, `${uid}.${exp}`)}`;
}
export async function lockerUser(env, token) {
  const [uid, exp, sig] = String(token || "").split(".");
  if (!uid || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return (await hmac(env, `${uid}.${exp}`)) === sig ? uid : null;
}

