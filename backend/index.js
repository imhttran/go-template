import "./loadEnv.js"; // loads the root .env before app.js reads process.env
import { app } from "./app.js";
import { startEmailWorker } from "./emailQueue.js";
import { seedDevAdmin } from "./seedDevAdmin.js";

const PORT = 3000;

await seedDevAdmin();

app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`);
});

// Email worker: polls the EmailQueue table and sends via nodemailer.
// Run in its own process (node emailWorker.js) if you want to scale mail out.
startEmailWorker();
