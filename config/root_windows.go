package config

import (
	"os"
	"path"
)

const requiredPermissions = 0777

func torusRootPath() string {
	torusRoot := os.Getenv("TORUS_ROOT")
	if len(torusRoot) == 0 {
		torusRoot = path.Join(os.Getenv("HOMEDRIVE"), os.Getenv("HomePath"), ".torus")
	}

	return torusRoot
}
