# הקמה חד-פעמית על השרת (VPS)

מריצים את זה **פעם אחת** בלבד, בטרמינל ה-SSH הפתוח על השרת. אחרי זה, כל עדכון עתידי הוא פוש ל-`main` או כפתור "Run workflow" בגיטהאב.

## 1. הוספת מפתח הדיפלוי (נפרד מהמפתח האישי שכבר הוספתם)

```bash
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPiz/wjqV9DaWeXFoC1ZA2CRmwpGgn6pnJFrg4vYrUYE github-actions-deploy' >> ~/.ssh/authorized_keys
```

## 2. התקנת Node.js ו-git (אם עדיין לא מותקנים)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git
node --version
```

## 3. שכפול הריפו

```bash
mkdir -p /opt/konspeta
git clone https://github.com/davidlandw/ad-studio.git /opt/konspeta
cd /opt/konspeta
```

## 4. העלאת `.env` ל-`/opt/konspeta/.env`

הקובץ הזה **לא** נמצא בגיט (בכוונה — יש בו סודות). מעתיקים אותו ידנית מהמחשב המקומי לשרת, למשל עם `scp` מהמחשב שממנו יש גישה לשרת:

```bash
scp .env root@<כתובת-השרת>:/opt/konspeta/.env
```

חשוב: לעדכן בתוכו את `APP_URL` לכתובת הדומיין האמיתית (`konspeta.com` וכו') כשהיא באוויר, ואת `TRUST_PROXY=1` אם יש Cloudflare/reverse proxy מלפנים.

## 5. בנייה ראשונית

```bash
npm run install:all
npm run build
```

## 6. הגדרת השירות (systemd)

```bash
cp deploy/konspeta.service /etc/systemd/system/konspeta.service
systemctl daemon-reload
systemctl enable konspeta
systemctl start konspeta
systemctl status konspeta
```

## 7. ב-GitHub — הוספת שני Secrets

בריפו: **Settings → Secrets and variables → Actions → New repository secret**

- `VPS_HOST` — כתובת ה-IP של השרת (`167.86.92.242`)
- `VPS_DEPLOY_KEY` — תוכן המפתח **הפרטי** (הודפס בצ'אט למעלה, מתחיל ב-`-----BEGIN OPENSSH PRIVATE KEY-----`)

זהו. מכאן, `git push origin main` (או כפתור "Run workflow" בטאב Actions בגיטהאב) מריץ אוטומטית: `git pull` בשרת → `npm install` → `npm run build` → `systemctl restart konspeta`.
