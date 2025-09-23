import { createServer } from './server';

const port = Number(process.env.PORT || 4000);
const app = createServer();

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
