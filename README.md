# dsh-shark-bg

在 DeepSeek Harness Web 界面背景里游动的 ASCII 鲨鱼。

一组鲨鱼在海水里巡游、追逐、捕食小鱼，全部用等宽字符光栅化绘制，作为整个界面的背景层运行。

## 效果

- 6 条鲨鱼（经典鲨、双髻鲨、虎鲨、斑马鲨、灰鲭鲨、锤头鲨）按体型缩放，各自巡游与捕食
- 上百条小鱼按 Reynolds boids 集群，带 Couzin 盲区、警报传染和喷泉式逃逸
- 鲨鱼有波动脊柱、转向侧倾、饥饿与进食状态
- 无散度海流场驱动整体漂移
- 深浅色主题自动适配，窗口缩放自适应，页面隐藏时暂停

## 安装

```bash
dsh plugin install https://github.com/iemgnod/dsh-shark-bg
```

或手动安装：把仓库放进 `~/.dsh/profiles/<profile>/node_modules/dsh-shark-bg`，并在该 profile 的 `package.json` 里把 `dsh-shark-bg` 加入 `dsh.profile.bundles`。

## 调参

遮罩强度由 CSS 变量控制，在浏览器控制台里改即可即时生效：

```css
html { --shark-veil: 58%; --shark-veil-strong: 88%; }
```

数值越小海水越明显，越大越淡。`--shark-veil-strong` 只作用于底部输入区。

## 实现要点

界面背景要透出来，必须解决一个叠加问题：DSH 的外壳有多层不透明容器，每层都加半透明遮罩会相乘叠加——两层 58% 就只剩不到 18% 的海水可见。

插件因此不硬编码类名（DSH 的类名带哈希前缀，随版本变化），而是在运行时探测：递归扫描 `#root` 下的元素，实测哪个又大又真的不透明，只给最外层那一个加遮罩，嵌套在里面的同类元素直接清成透明。菜单、弹窗、toast 等悬浮层全部跳过，保持实心。

## 许可

MIT
