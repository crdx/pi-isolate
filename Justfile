set quiet := true
set shell := ["bash", "-cu", "-o", "pipefail"]

[private]
help:
    just --list --unsorted --list-submodules

pi *args:
    pi --skill .agents/skills --tools read,write,edit,grep,ls,find --extension-tools=run_script -ne -e . "{{ args }}"
