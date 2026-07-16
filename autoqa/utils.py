import os
import logging
import subprocess
import psutil
import time
import pyautogui
import platform
from pathlib import Path

logger = logging.getLogger(__name__)

# Cross-platform window management
IS_LINUX = platform.system() == "Linux"
IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"

if IS_WINDOWS:
    try:
        import pygetwindow as gw
    except ImportError:
        gw = None
        logger.warning("pygetwindow not available on this system")

def is_biyan_running(biyan_process_name="Biyan.exe"):
    """
    Check if Biyan application is currently running.
    """
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] and biyan_process_name.lower() in proc.info['name'].lower():
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return False

def force_close_biyan(biyan_process_name="Biyan.exe"):
    """
    Force close Biyan application if it is running.
    """
    logger.info("Checking for running Biyan processes...")
    closed_any = False
    
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] and biyan_process_name.lower() in proc.info['name'].lower():
                logger.info(f"Force closing Biyan process (PID: {proc.info['pid']})")
                proc.kill()
                closed_any = True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    
    if closed_any:
        logger.info("Waiting for Biyan processes to terminate...")
        time.sleep(3)  # Wait for processes to fully terminate
    else:
        logger.info("No Biyan processes found running")

def find_biyan_window_linux():
    """
    Find Biyan window on Linux using wmctrl.
    """
    try:
        result = subprocess.run(['wmctrl', '-l'], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            for line in result.stdout.split('\n'):
                if 'biyan' in line.lower():
                    # Extract window ID (first column)
                    window_id = line.split()[0]
                    logger.info(f"Found Biyan window with ID: {window_id}")
                    return window_id
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError) as e:
        logger.warning(f"wmctrl command failed: {e}")
    return None

def maximize_biyan_window_linux():
    """
    Maximize Biyan window on Linux using wmctrl.
    """
    window_id = find_biyan_window_linux()
    if window_id:
        try:
            # Maximize window using wmctrl
            subprocess.run(['wmctrl', '-i', '-r', window_id, '-b', 'add,maximized_vert,maximized_horz'], 
                         timeout=5)
            logger.info("Biyan window maximized using wmctrl")
            return True
        except (subprocess.TimeoutExpired, subprocess.SubprocessError) as e:
            logger.warning(f"Failed to maximize with wmctrl: {e}")
    
    # Fallback: Try xdotool
    try:
        result = subprocess.run(['xdotool', 'search', '--name', 'Biyan'],
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            window_id = result.stdout.strip().split('\n')[0]
            subprocess.run(['xdotool', 'windowactivate', window_id], timeout=5)
            subprocess.run(['xdotool', 'key', 'alt+F10'], timeout=5)  # Maximize shortcut
            logger.info("Biyan window maximized using xdotool")
            return True
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError) as e:
        logger.warning(f"xdotool command failed: {e}")
    
    return False

def find_biyan_window_macos():
    """
    Find Biyan window on macOS using AppleScript.
    """
    try:
        # AppleScript to find Biyan window
        script = '''
        tell application "System Events"
            set biyanApps to (every process whose name contains "Biyan")
            if length of biyanApps > 0 then
                return name of first item of biyanApps
            else
                return ""
            end if
        end tell
        '''
        result = subprocess.run(['osascript', '-e', script], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0 and result.stdout.strip():
            app_name = result.stdout.strip()
            logger.info(f"Found Biyan app: {app_name}")
            return app_name
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError) as e:
        logger.warning(f"AppleScript command failed: {e}")
    return None

def maximize_biyan_window_macos():
    """
    Maximize Biyan window on macOS using AppleScript.
    """
    app_name = find_biyan_window_macos()
    if app_name:
        try:
            # AppleScript to maximize window
            script = f'''
            tell application "System Events"
                tell process "{app_name}"
                    set frontmost to true
                    tell window 1
                        set value of attribute "AXFullScreen" to true
                    end tell
                end tell
            end tell
            '''
            result = subprocess.run(['osascript', '-e', script], timeout=10)
            if result.returncode == 0:
                logger.info("Biyan window maximized using AppleScript")
                return True
        except (subprocess.TimeoutExpired, subprocess.SubprocessError) as e:
            logger.warning(f"Failed to maximize with AppleScript: {e}")
    
    # Fallback: Try Command+M (fullscreen hotkey on macOS)
    try:
        logger.info("Trying Cmd+Ctrl+F hotkey to maximize")
        pyautogui.hotkey('cmd', 'ctrl', 'f')
        time.sleep(1)
        logger.info("Attempted to maximize using Cmd+Ctrl+F")
        return True
    except Exception as e:
        logger.warning(f"Hotkey maximize failed: {e}")
    
    return False

def maximize_biyan_window():
    """
    Find and maximize Biyan window (cross-platform).
    """
    try:
        # Wait a bit for window to appear
        time.sleep(2)
        
        if IS_LINUX:
            return maximize_biyan_window_linux()
        
        elif IS_MACOS:
            return maximize_biyan_window_macos()
        
        elif IS_WINDOWS and gw:
            # Method 1: Try to find window by title containing "Biyan"
            windows = gw.getWindowsWithTitle("Biyan")
            if windows:
                biyan_window = windows[0]
                logger.info(f"Found Biyan window: {biyan_window.title}")
                biyan_window.maximize()
                logger.info("Biyan window maximized using pygetwindow")
                return True
        
        # Fallback methods for both platforms
        # Method 2: Try Alt+Space then X (maximize hotkey) - works on both platforms
        logger.info("Trying Alt+Space+X hotkey to maximize")
        pyautogui.hotkey('alt', 'space')
        time.sleep(0.5)
        pyautogui.press('x')
        logger.info("Attempted to maximize using Alt+Space+X")
        return True
        
    except Exception as e:
        logger.warning(f"Could not maximize Biyan window: {e}")
        
        # Method 3: Platform-specific fallback
        try:
            if IS_WINDOWS:
                logger.info("Trying Windows+Up arrow to maximize")
                pyautogui.hotkey('win', 'up')
            elif IS_LINUX:
                logger.info("Trying Alt+F10 to maximize")
                pyautogui.hotkey('alt', 'F10')
            elif IS_MACOS:
                logger.info("Trying macOS specific maximize")
                pyautogui.hotkey('cmd', 'tab')  # Switch to Biyan if it is running
                time.sleep(0.5)
            return True
        except Exception as e2:
            logger.warning(f"All maximize methods failed: {e2}")
            return False

def start_biyan_app(biyan_app_path=None):
    """
    Start Biyan application in maximized window (cross-platform).
    """
    # Set default path based on platform
    if biyan_app_path is None:
        if IS_WINDOWS:
            biyan_app_path = os.path.expanduser(r"~\AppData\Local\Programs\Biyan\Biyan.exe")
        elif IS_LINUX:
            biyan_app_path = "/usr/bin/Biyan"
        elif IS_MACOS:
            biyan_app_path = "/Applications/Biyan.app/Contents/MacOS/Biyan"
        else:
            raise NotImplementedError(f"Platform {platform.system()} not supported")
    
    logger.info(f"Starting Biyan application from: {biyan_app_path}")
    
    if not os.path.exists(biyan_app_path):
        logger.error(f"Biyan executable not found at: {biyan_app_path}")
        raise FileNotFoundError(f"Biyan app not found at {biyan_app_path}")
    
    try:
        # Start the Biyan application
        if IS_WINDOWS:
            subprocess.Popen([biyan_app_path], shell=True)
        elif IS_LINUX:
            # On Linux, start with DISPLAY environment variable
            env = os.environ.copy()
            subprocess.Popen([biyan_app_path], env=env)
        elif IS_MACOS:
            # On macOS, use 'open' command to launch .app bundle properly
            if biyan_app_path.endswith('.app/Contents/MacOS/Biyan'):
                # Use the .app bundle path instead
                app_bundle = biyan_app_path.replace('/Contents/MacOS/Biyan', '')
                subprocess.Popen(['open', app_bundle])
            elif biyan_app_path.endswith('.app'):
                # Direct .app bundle
                subprocess.Popen(['open', biyan_app_path])
            elif '/Contents/MacOS/' in biyan_app_path:
                # Extract app bundle from full executable path
                app_bundle = biyan_app_path.split('/Contents/MacOS/')[0]
                subprocess.Popen(['open', app_bundle])
            else:
                # Fallback: try to execute directly
                subprocess.Popen([biyan_app_path])
        else:
            raise NotImplementedError(f"Platform {platform.system()} not supported")
        logger.info("Biyan application started")
        
        # Wait for app to fully load
        logger.info("Waiting for Biyan application to initialize...")
        time.sleep(5)
        
        # Try to maximize the window
        if maximize_biyan_window():
            logger.info("Biyan application maximized successfully")
        else:
            logger.warning("Could not maximize Biyan application window")
        
        # Wait a bit more after maximizing
        time.sleep(10)
        logger.info("Biyan application should be ready, waiting for additional setup...")
        time.sleep(10)  # Additional wait to ensure everything is ready
        
    except Exception as e:
        logger.error(f"Error starting Biyan application: {e}")
        raise

def scan_test_files(tests_dir="tests"):
    """
    Scan tests folder and find all .txt files
    Returns list with format [{'path': 'relative_path', 'prompt': 'file_content'}]
    """
    test_files = []
    tests_path = Path(tests_dir)
    
    if not tests_path.exists():
        logger.error(f"Tests directory {tests_dir} does not exist!")
        return test_files
    
    # Scan all .txt files in folder and subfolders
    for txt_file in tests_path.rglob("*.txt"):
        try:
            # Read file content
            with open(txt_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            
            # Get relative path
            relative_path = txt_file.relative_to(tests_path)
            
            test_files.append({
                'path': str(relative_path),
                'prompt': content
            })
            logger.info(f"Found test file: {relative_path}")
        except Exception as e:
            logger.error(f"Error reading file {txt_file}: {e}")
    
    return test_files

def get_latest_trajectory_folder(trajectory_base_path):
    """
    Get the latest created folder in trajectory base path
    """
    if not os.path.exists(trajectory_base_path):
        logger.warning(f"Trajectory base path not found: {trajectory_base_path}")
        return None
    
    # Get all folders and sort by creation time (latest first)
    folders = [f for f in os.listdir(trajectory_base_path) 
               if os.path.isdir(os.path.join(trajectory_base_path, f))]
    
    if not folders:
        logger.warning(f"No trajectory folders found in: {trajectory_base_path}")
        return None
    
    # Sort by folder name (assuming timestamp format like 20250715_100443)
    folders.sort(reverse=True)
    latest_folder = folders[0]
    
    full_path = os.path.join(trajectory_base_path, latest_folder)
    logger.info(f"Found latest trajectory folder: {full_path}")
    return full_path
