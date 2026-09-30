'use strict';
const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');
// Answers belong only to this runner invocation, never to persisted checkpoints.
class AppApprovals {
    constructor(input, emit) {
        this.pending = new Map(); this.emit = emit;
        this.reader = createInterface({ input });
        this.reader.on('line', line => {
            if (line.length > 4096) return;
            let answer; try { answer = JSON.parse(line); } catch (_) { return; }
            if (answer.type !== 'appApproval' || !this.pending.has(answer.requestId)) return;
            const resolve = this.pending.get(answer.requestId); this.pending.delete(answer.requestId);
            resolve(answer.action === 'accept' ? 'accept' : 'decline');
        });
        this.reader.on('close', () => this.cancel());
    }
    ask(request) {
        const requestId = randomUUID();
        return new Promise(resolve => { this.pending.set(requestId, resolve); this.emit({ type: 'appApproval', requestId, ...request }); });
    }
    cancel() { for (const resolve of this.pending.values()) resolve('decline'); this.pending.clear(); }
    close() { this.cancel(); this.reader.close(); }
}
module.exports = { AppApprovals };
