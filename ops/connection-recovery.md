# Web and mobile connection recovery

`connection.js` adds the same bounded startup and listener recovery as the local viewer. It loads after shared/core.js and before script.js. Deploy Pages must include this file and replace its cache version with the deployed commit.

The status strip is outside the mobile controls accordion; buttons are at least 44px tall on mobile. Online return, visibility return after a minute without a server receipt, and persisted pageshow (back/forward cache restore) reattach the listener. No page reload is used, preserving open edits. Logs contain only time/event/error code (last 200 records).

Validation:

```
node --test local/tests/connection.test.cjs
CONNECTION_SOURCE="$PWD/connection.js" node --test local/tests/connection.test.cjs
```

A successful initial load does not establish that a long-duration WebKit freeze has been fixed. Use the connection log when symptoms recur.
