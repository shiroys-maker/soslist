on run
	«event sysoexec» "open -na 'Google Chrome' --args --app='http://127.0.0.1:8787/local/index.html'"
end run

on idle
	return 60
end idle

on quit
	continue quit
end quit
