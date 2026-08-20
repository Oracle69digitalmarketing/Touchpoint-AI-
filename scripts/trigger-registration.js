const payload = {
  email: 'oracle69digital@gmail.com',
  password: 'password123',
  name: 'E2E Tester',
  businessName: 'E2E Biz'
};

fetch('http://localhost:3000/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data)))
  .catch(err => console.error(err));
