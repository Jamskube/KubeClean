const nf = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
const ni = new Intl.NumberFormat('fr-BE');
const df = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' });

export const fmt = (b) => (b >= 1e12 ? `${nf.format(b / 1e12)} To` : b >= 1e9 ? `${nf.format(b / 1e9)} Go` : b >= 1e6 ? `${nf.format(b / 1e6)} Mo` : b >= 1e3 ? `${nf.format(b / 1e3)} Ko` : b > 0 ? `${b} o` : '0 Go');
export const int = (n) => ni.format(n);
export const plural = (n, one, many) => `${ni.format(n)} ${n > 1 ? many : one}`;
export const date = (ms) => df.format(new Date(ms));
export const idle = (d) => (d == null ? 'activité inconnue' : d <= 0 ? 'modifié aujourd’hui' : `inactif depuis ${plural(d, 'jour', 'jours')}`);
export const drive = (root) => (root === '/' ? 'Macintosh HD' : root.replace(/\\$/, ''));
