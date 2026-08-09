#!/bin/sh
cd "$(dirname "$0")" || exit 1
npm run launch
status=$?
if [ "$status" -ne 0 ]; then
  printf "\n启动未完成，请把上面的提示发给安装人员。\n"
  read -r _
fi
exit "$status"
