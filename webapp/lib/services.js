const net = require('net');
const { execSync } = require('child_process');

const SERVICES = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    port: 5433,
    description: 'Local dev database (shared by mystique & api-service)',
    startCmd: 'cd $MYSTIQUE_DIR && make dev-db-up',
    startCmdFull: (mystique) => `cd ${mystique} && make dev-db-up`,
    stopCmd: (mystique) => `cd ${mystique} && docker-compose -f docker-compose.dev-db.yml down`,
  },
  {
    id: 'localstack',
    label: 'LocalStack (SQS/S3)',
    port: 4566,
    description: 'Mocks AWS SQS and S3 locally',
    startCmd: 'cd $MYSTIQUE_DIR && docker-compose -f docker-compose.localstack.yml up -d',
    startCmdFull: (mystique) => `cd ${mystique} && docker-compose -f docker-compose.localstack.yml up -d`,
    stopCmd: (mystique) => `cd ${mystique} && docker-compose -f docker-compose.localstack.yml down`,
  },
  {
    id: 'mystique',
    label: 'Mystique',
    port: 8080,
    description: 'AI guidance service (FastAPI/Python)',
    startCmd: 'cd $MYSTIQUE_DIR && ./run-server.sh --with-localstack',
    startCmdFull: (mystique) => `cd ${mystique} && ./run-server.sh --with-localstack`,
    stopCmd: null,
  },
  {
    id: 'api-service',
    label: 'API Service',
    port: 3002,
    description: 'SpaceCat API (Node.js)',
    startCmd: 'cd $API_SERVICE_DIR && npm start',
    startCmdFull: (apiService) => `cd ${apiService} && npm start`,
    stopCmd: null,
  },
];

/**
 * Checks if a port is open (service is running) via TCP probe.
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Returns status of all local services.
 */
async function getServicesStatus(paths = {}) {
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const running = await checkPort(svc.port);

      // Build context-aware start command using actual paths if available
      let startCommand = svc.startCmd;
      if (svc.id === 'postgres' || svc.id === 'localstack' || svc.id === 'mystique') {
        if (paths.mystiqueDir) startCommand = svc.startCmdFull(paths.mystiqueDir);
      } else if (svc.id === 'api-service' && paths.apiServiceDir) {
        startCommand = svc.startCmdFull(paths.apiServiceDir);
      }

      return {
        id: svc.id,
        label: svc.label,
        port: svc.port,
        description: svc.description,
        running,
        startCommand,
      };
    }),
  );

  return results;
}

module.exports = { SERVICES, checkPort, getServicesStatus };
