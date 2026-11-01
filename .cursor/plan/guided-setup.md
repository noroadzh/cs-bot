# 分步部署向导

`deploy/install.sh` 保持非交互。新增 `deploy/setup.sh`：按步骤说明参数作用和改错后的影响，写入 `.env`，再调用现有安装。结束后打印企微后台字段与后续修改对应的变量和命令。Compose 通过 `--env-file` 读取仓库根目录 `.env`。
