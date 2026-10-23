# ==================================================================================== #
# CONFIG
# ==================================================================================== #

main_package_path = ./cmd/valheim-forge
binary_name = valheim-forge
site_dir = ./site
valheim_data = /mnt/c/Program Files (x86)/Steam/steamapps/common/Valheim/valheim_Data
valheim_softref = ${valheim_data}/StreamingAssets/SoftRef
game_version = $(shell grep -o 'new GameVersion([0-9, ]*)' reference/assembly_valheim/Version.cs 2>/dev/null | tail -1 | tr -d 'newGamVrsio() ' | tr ',' '.')
alpine_tag = 3.22

# ==================================================================================== #
# HELPERS
# ==================================================================================== #

## help: print this help message
.PHONY: help
help:
	@echo 'Usage:'
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' | sed -e 's/^/ /'

.PHONY: confirm
confirm:
	@echo -n 'Are you sure? [y/N] ' && read ans && [ $${ans:-N} = y ]

.PHONY: no-dirty
no-dirty:
	@test -z "$(shell git status --porcelain)"

# ==================================================================================== #
# QUALITY CONTROL
# ==================================================================================== #

## tidy: tidy modfiles and format .go files
.PHONY: tidy
tidy:
	go mod tidy -v
	go fmt ./...

## audit: run quality control checks
.PHONY: audit
audit: test
	go mod tidy -diff
	go mod verify
	test -z "$(shell gofmt -l .)"
	go vet ./...
	go run honnef.co/go/tools/cmd/staticcheck@latest -checks=all,-ST1000,-U1000 ./...
	go run golang.org/x/vuln/cmd/govulncheck@latest ./...

## test: run all tests
.PHONY: test
test:
	go test -v -race -buildvcs ./...
	node --test "test/*.test.mjs"

# ==================================================================================== #
# DEVELOPMENT
# ==================================================================================== #

## data: pull items, recipes, stations and icons out of the game into site/
.PHONY: data
data:
	go run ./cmd/forge-data -softref "${valheim_softref}" -out ${site_dir} -game "${game_version}"

## reference: decompile the game assemblies into reference/ (needs Docker and valheim-npc beside this checkout)
.PHONY: reference
reference:
	VALHEIM_MANAGED="${valheim_data}/Managed" ../valheim-npc/tools/decompile.sh reference

## build: build the server with the site embedded
.PHONY: build
build:
	go build -o=bin/${binary_name} ${main_package_path}

## run: serve site/ from disk at http://localhost:2480
.PHONY: run
run:
	go run ${main_package_path} -dir ${site_dir}

# ==================================================================================== #
# OPERATIONS
# ==================================================================================== #

## docker/build: build the image from the prebuilt binary
.PHONY: docker/build
docker/build: build
	docker build --build-arg ALPINE_TAG=${alpine_tag} -t ${binary_name}:latest .
