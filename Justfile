set quiet := true
set shell := ["bash", "-cu", "-o", "pipefail"]

[private]
help:
    just --list --unsorted --list-submodules

pi *args:
    pi --no-skills --tools read,write,edit,grep,ls,find -ne -e . "{{ args }}"
