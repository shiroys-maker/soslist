-- SOSList.app のソース（Web版UIを手元リポジトリの file:// でChromeアプリウィンドウとして開く）
-- 再コンパイル:
--   osacompile -o "/Applications/SOSList.app" ops/soslist-launcher.applescript
on run
	do shell script "open -na 'Google Chrome' --args --app='file:///Users/shungohiroyasu/Documents/GitHub/soslist/index.html'"
end run
