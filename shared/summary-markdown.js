/* Summary presentation only: never changes stored source or fetches resources. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./vendor/markdown-it/markdown-it.umd.min.js'));
    } else {
        root.SOSSummaryMarkdown = factory(root.markdownit);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (MarkdownIt) {
    'use strict';
    function escapeHtml(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeLink(value) {
        if (typeof value !== 'string' || /[\u0000-\u0020\u007f-\u009f]/.test(value)) return false;
        if (!/^(https?:\/\/|mailto:)/i.test(value)) return false;
        try {
            const url = new URL(value);
            return (url.protocol === 'http:' || url.protocol === 'https:') ? Boolean(url.hostname) : url.protocol === 'mailto:';
        } catch { return false; }
    }
    let renderer;
    if (typeof MarkdownIt === 'function') {
        renderer = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });
        renderer.validateLink = safeLink;
        renderer.renderer.rules.link_open = function (tokens, index, options, env, self) {
            tokens[index].attrSet('target', '_blank');
            tokens[index].attrSet('rel', 'noopener noreferrer');
            tokens[index].attrSet('referrerpolicy', 'no-referrer');
            return self.renderToken(tokens, index, options);
        };
        // Alt text remains selectable. No img/source/srcset is ever emitted, even for data: URLs.
        renderer.renderer.rules.image = function (tokens, index, options, env, self) {
            const alt = self.renderInlineAsText(tokens[index].children || [], options, env);
            return '<span class="summary-image-alt">' + escapeHtml(alt || '画像') + '（画像は読み込みません）</span>';
        };
    }
    function render(markdown) {
        const source = String(markdown ?? '');
        if (renderer) return renderer.render(source);
        return '<p>' + escapeHtml(source).replace(/\r\n?|\n/g, '<br>') + '</p>';
    }
    return Object.freeze({ render });
}));
