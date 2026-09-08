# Web and mobile connection recovery

`connection.js` adds the same bounded startup and listener recovery as the local viewer. It loads after shared/core.js and before script.js. Deploy Pages must include this file and replace its cache version with the deployed commit.

After five initial retries, Web/mobile retries once per minute until recovered or logged out (terminal permission/query errors are not retried). Web/mobile recovery runs in the background without a status strip, reconnect button, or log export button. Online return, visibility return after a minute without a server receipt, and persisted pageshow (back/forward cache restore) reattach the listener. No page reload is used, preserving open edits. Logs remain in localStorage with only time/event/error code (last 200 records). The native local app retains its visible controls.


Validation:

```
node --test local/tests/connection.test.cjs
CONNECTION_SOURCE="$PWD/connection.js" node --test local/tests/connection.test.cjs
```

A successful initial load does not establish that a long-duration WebKit freeze has been fixed. Use the connection log when symptoms recur.
