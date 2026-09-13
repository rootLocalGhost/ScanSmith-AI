import os
import sys
from collections import OrderedDict
import torch
import openvino as ov
import numpy as np

# Ensure models directory is in sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import restormer_arch

def convert_state_dict(state_dict):
    new_state_dict = OrderedDict()
    for k, v in state_dict.items():
        name = k[7:] if k.startswith("module.") else k
        new_state_dict[name] = v
    return new_state_dict

def main():
    model_path = os.path.join(SCRIPT_DIR, "docres.pkl")
    out_xml = os.path.join(SCRIPT_DIR, "docres_fp16.xml")

    if not os.path.exists(model_path):
        print(f"Error: {model_path} not found!")
        sys.exit(1)

    print("Loading PyTorch Restormer architecture...")
    model = restormer_arch.Restormer(
        inp_channels=6,
        out_channels=3,
        dim=48,
        num_blocks=[2, 3, 3, 4],
        num_refinement_blocks=4,
        heads=[1, 2, 4, 8],
        ffn_expansion_factor=2.66,
        bias=False,
        LayerNorm_type="WithBias",
        dual_pixel_task=True,
    )

    print(f"Loading weights from {model_path}...")
    checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
    state = convert_state_dict(checkpoint["model_state"])
    model.load_state_dict(state)
    model.eval()

    print("Converting PyTorch model to OpenVINO...")
    # Example input with batch 1, 6 channels, 1024x1024
    example_input = torch.zeros(1, 6, 1024, 1024, dtype=torch.float32)
    ov_model = ov.convert_model(model, example_input=example_input)

    # Dynamic spatial dimensions for document sizes
    print("Setting dynamic spatial dimensions...")
    ov_model.reshape([1, 6, -1, -1])

    print(f"Saving OpenVINO FP16 model to {out_xml}...")
    ov.save_model(ov_model, out_xml, compress_to_fp16=True)

    print("Validating model on Intel Arc A770 (GPU)...")
    core = ov.Core()
    devices = core.available_devices
    print(f"Available OpenVINO devices: {devices}")
    
    target_device = "GPU" if "GPU" in devices else "CPU"
    device_name = core.get_property(target_device, "FULL_DEVICE_NAME")
    print(f"Compiling on target device: {target_device} ({device_name})...")
    
    compiled_model = core.compile_model(ov_model, target_device)
    print(f"Compilation on {target_device} succeeded!")

    # Test inference
    dummy_input = np.zeros((1, 6, 512, 512), dtype=np.float32)
    res = compiled_model([dummy_input])[0]
    print(f"Test inference output shape: {res.shape}, min: {res.min()}, max: {res.max()}")
    print("Conversion and verification complete!")

if __name__ == "__main__":
    main()
