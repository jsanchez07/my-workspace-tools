/**
 * Process runner with SSE log streaming.
 *
 * Jobs are spawned via child_process.spawn. Each job has:
 *   - A unique ID
 *   - A buffer of output lines (so late SSE subscribers can catch up)
 *   - A set of active SSE response objects
 *   - A status: 'running' | 'success' | 'error'
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

// In-memory job registry
const jobs = new Map();

/**
 * Starts a new job and returns its ID.
 *
 * @param {string} command - Command to run (e.g. 'bash')
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory
 * @param {object} env - Additional environment variables
 * @returns {string} jobId
 */
function startJob(command, args, cwd, env = {}, onComplete = null) {
  const jobId = randomUUID();
  const buffer = [];
  const clients = new Set();

  const job = {
    id: jobId,
    command,
    args,
    cwd,
    status: 'running',
    buffer,
    clients,
    process: null,
    startedAt: Date.now(),
  };

  jobs.set(jobId, job);

  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    detached: true, // Creates a new process group so we can kill the whole tree
  });

  job.process = proc;

  const emit = (type, text) => {
    const line = { type, text, ts: Date.now() };
    buffer.push(line);
    for (const res of clients) {
      sendEvent(res, line);
    }
  };

  proc.stdout.on('data', (chunk) => {
    // Split on newlines so each line is a discrete event
    chunk.toString().split('\n').forEach((line) => {
      if (line) emit('stdout', line);
    });
  });

  proc.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').forEach((line) => {
      if (line) emit('stderr', line);
    });
  });

  proc.on('error', (err) => {
    emit('error', `Process error: ${err.message}`);
    job.status = 'error';
    emit('done', JSON.stringify({ status: 'error', code: null }));
  });

  proc.on('close', (code) => {
    job.status = code === 0 ? 'success' : 'error';
    emit('done', JSON.stringify({ status: job.status, code }));
    job.process = null;
    if (typeof onComplete === 'function') {
      try { onComplete(job.status, code); } catch { /* ignore */ }
    }
  });

  return jobId;
}

/**
 * Writes an SSE event to a response object.
 */
function sendEvent(res, { type, text, ts }) {
  try {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify({ text, ts })}\n\n`);
  } catch {
    // Client disconnected — will be cleaned up on close
  }
}

/**
 * Attaches an SSE response to a job stream.
 * Replays the buffer first, then sends live events.
 */
function streamJob(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay buffer
  for (const event of job.buffer) {
    sendEvent(res, event);
  }

  // If job is already done, close immediately
  if (job.status !== 'running') {
    res.end();
    return;
  }

  job.clients.add(res);

  res.on('close', () => {
    job.clients.delete(res);
  });
}

/**
 * Kills a running job and its entire process group.
 * Uses negative PID to kill all processes in the group (requires detached: true on spawn).
 */
function killJob(jobId) {
  const job = jobs.get(jobId);
  if (job && job.process) {
    try {
      process.kill(-job.process.pid, 'SIGTERM');
    } catch {
      // Fallback if process group kill fails (e.g. process already exited)
      try { job.process.kill('SIGTERM'); } catch { /* ignore */ }
    }
    job.status = 'error';
    job.process = null;
  }
}

/**
 * Returns a summary of a job (without buffer/clients).
 */
function getJobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    command: job.command,
    args: job.args,
    startedAt: job.startedAt,
    lines: job.buffer.length,
  };
}

/**
 * Cleans up old completed jobs (keep last 20).
 */
function pruneJobs() {
  if (jobs.size <= 20) return;
  const entries = [...jobs.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
  const toDelete = entries.slice(0, jobs.size - 20);
  for (const [id] of toDelete) {
    jobs.delete(id);
  }
}

/**
 * Returns summary of all jobs (running ones first).
 */
function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((job) => ({
      id: job.id,
      status: job.status,
      command: job.command,
      args: job.args,
      startedAt: job.startedAt,
      lines: job.buffer.length,
    }));
}

/**
 * Returns the full output buffer for a job (for results parsing).
 */
function getJobBuffer(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { buffer: [...job.buffer], status: job.status };
}

module.exports = { startJob, streamJob, killJob, getJobStatus, listJobs, getJobBuffer };
