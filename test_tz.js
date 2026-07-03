const fs = require('fs'); 
const env = fs.readFileSync('.env.local', 'utf-8'); 
const key = env.match(/INSTANTLY_API_KEY=(.+)/)[1].trim(); 
const sendingAccount = env.match(/INSTANTLY_SENDING_ACCOUNTS=(.+)/)[1].split(',')[0].trim();

fetch('https://api.instantly.ai/api/v2/campaigns', { 
  method: 'POST', 
  headers: { 
    'Authorization': 'Bearer ' + key, 
    'Content-Type': 'application/json' 
  }, 
  body: JSON.stringify({ 
    name: 'Test TZ', 
    daily_limit: 10,
    email_list: [sendingAccount],
    campaign_schedule: { 
      schedules: [{ 
        name: 'Default', 
        timing: { from: '09:00', to: '17:00' }, 
        days: { "1": true, "2": true, "3": true, "4": true, "5": true, "6": false, "0": false }, 
        timezone: 'Etc/UTC' 
      }] 
    }, 
    sequences: [{ 
      steps: [{ 
        type: 'email', 
        delay: 0,
        variants: [{ subject: 'a', body: 'b' }] 
      }] 
    }] 
  }) 
}).then(r => r.json()).then(console.log);
