
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent / "public"
PASTA_FOTOS = ROOT / "Fotos"
PASTA_MINI = ROOT / "mini"
PASTA_CONVERTIDAS = PASTA_MINI / "convertidas"
SAIDA = ROOT / "local-fotos.js"

FORMATOS_WEB = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
FORMATOS_HEIC = {".heic", ".heif"}


def nome_seguro(texto):
    texto = texto.lower().strip()
    texto = re.sub(r"\s+", "-", texto)
    return re.sub(r"[^a-z0-9_-]", "", texto)


def converter_heic(arquivo):
    try:
        from PIL import Image
        from pillow_heif import register_heif_opener

        register_heif_opener()
        PASTA_CONVERTIDAS.mkdir(parents=True, exist_ok=True)

        destino = PASTA_CONVERTIDAS / f"{arquivo.stem}.jpg"

        if destino.exists() and destino.stat().st_mtime >= arquivo.stat().st_mtime:
            return destino

        with Image.open(arquivo) as imagem:
            imagem = imagem.convert("RGB")
            imagem.save(destino, "JPEG", quality=90, optimize=True)

        print(f"Convertida: {arquivo.name}")
        return destino

    except ImportError:
        return None
    except Exception as erro:
        print(f"Não foi possível converter {arquivo.name}: {erro}")
        return None


def main():
    if not PASTA_FOTOS.exists():
        print(f"Pasta não encontrada: {PASTA_FOTOS}")
        return

    albuns = {}
    quantidade = 0
    heic_pendentes = 0

    for arquivo in PASTA_FOTOS.rglob("*"):
        if not arquivo.is_file():
            continue

        extensao = arquivo.suffix.lower()

        if extensao not in FORMATOS_WEB | FORMATOS_HEIC:
            continue

        imagem_web = arquivo

        if extensao in FORMATOS_HEIC:
            imagem_web = converter_heic(arquivo)
            if imagem_web is None:
                heic_pendentes += 1
                continue

        pasta_relativa = arquivo.parent.relative_to(PASTA_FOTOS)
        nome_album = pasta_relativa.parts[0] if pasta_relativa.parts else "Momentos especiais"
        chave_album = nome_seguro(nome_album) or "momentos-especiais"

        caminho_web = imagem_web.relative_to(ROOT).as_posix()

        albuns.setdefault(chave_album, []).append({
            "url": caminho_web,
            "original_url": caminho_web,
            "caption": arquivo.stem.replace("_", " ").replace("-", " ")
        })
        quantidade += 1

    # Compatibilidade com o álbum de demonstração atual do site.
    todas = [foto for lista in albuns.values() for foto in lista]
    albuns["momentos"] = todas
    albuns["momentos-especiais"] = todas

    conteudo = (
        "window.NATHANAEL_FOTOS_LOCAIS = "
        + json.dumps(albuns, ensure_ascii=False, indent=2)
        + ";\n"
    )
    SAIDA.write_text(conteudo, encoding="utf-8")

    print(f"\nArquivo criado: {SAIDA.name}")
    print(f"Imagens prontas para o navegador: {quantidade}")
    print(f"Arquivos HEIC/HEIF ainda não convertidos: {heic_pendentes}")

    if heic_pendentes:
        print("\nPara habilitar a conversão HEIC, execute:")
        print("python -m pip install Pillow pillow-heif")

    if quantidade == 0 and heic_pendentes == 0:
        print("Nenhuma imagem compatível encontrada dentro de Fotos.")


if __name__ == "__main__":
    main()
