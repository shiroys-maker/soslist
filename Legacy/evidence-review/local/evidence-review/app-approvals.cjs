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
            const pending = this.pending.get(answer.requestId);
            if (!pending || answer.type !== pending.type) return;
            this.pending.delete(answer.requestId);
            pending.resolve(answer.action === 'accept' ? 'accept' : 'decline');
        });
        this.reader.on('close', () => this.cancel());
    }
    ask(request, type = 'appApproval') {
        if (!['appApproval', 'intakeApproval'].includes(type)) throw Error('Unknown approval type');
        const requestId = randomUUID();
        return new Promise(resolve => { this.pending.set(requestId, { resolve, type }); this.emit({ ...request, type, requestId }); });
    }
    cancel() { for (const pending of this.pending.values()) pending.resolve('decline'); this.pending.clear(); }
    close() { this.cancel(); this.reader.close(); }
}
module.exports = { AppApprovals };
