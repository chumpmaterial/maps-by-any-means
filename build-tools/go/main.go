package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
)

//go:embed dist/*
var distFS embed.FS

func main() {
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}

	http.Handle("/", http.FileServer(http.FS(subFS)))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}

	url := fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
	fmt.Printf("MBAM running at %s\n", url)
	fmt.Println("Press Ctrl+C to stop.")

	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()

	http.Serve(listener, nil)
}
