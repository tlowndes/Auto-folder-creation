import os

def create_design_folders(main_folder_path, project_name):
    folders = ['Copy', 'Export', 'Image', 'Project Files']
    for folder in folders:
        folder_path = os.path.join(main_folder_path, folder)
        os.makedirs(folder_path, exist_ok=True)
    # Create a Word document with the project name followed by '_brief'
    with open(os.path.join(main_folder_path, f"{project_name}_brief.docx"), 'w') as f:
        pass

def create_work_folders(main_folder_path, project_name):
    folders = ['Copy', 'Export', 'Image', 'Project Files']
    for folder in folders:
        folder_path = os.path.join(main_folder_path, folder)
        os.makedirs(folder_path, exist_ok=True)
    # Create a Word document with the project name followed by '_brief'
    with open(os.path.join(main_folder_path, f"{project_name}_brief.docx"), 'w') as f:
        pass

def create_video_folders(main_folder_path, project_name):
    folders = ['Audio', 'Footage', 'Image', 'Project Files', 'Export']
    for folder in folders:
        folder_path = os.path.join(main_folder_path, folder)
        os.makedirs(folder_path, exist_ok=True)
    # Create a Word document with the project name followed by '_brief'
    with open(os.path.join(main_folder_path, f"{project_name}_brief.docx"), 'w') as f:
        pass

def create_idea_folders(main_folder_path, project_name):
    folders = ['Image', 'Project Files']
    for folder in folders:
        folder_path = os.path.join(main_folder_path, folder)
        os.makedirs(folder_path, exist_ok=True)
    # Create a Word document with the project name followed by '_brief'
    with open(os.path.join(main_folder_path, f"{project_name}_brief.docx"), 'w') as f:
        pass

def create_project_folders():
    print("Select the type of project:")
    print("1. Personal")
    print("2. Work")
    print("3. Video")
    print("4. Idea")

    choice = input("Enter your choice (1/2/3/4): ")

    if choice == '1':
        project_type = 'design'
        project_folder = 'design_projects'
    elif choice == '2':
        project_type = 'work'
        project_folder = r'work_projects\Dove Technology'
    elif choice == '3':
        project_type = 'video'
        project_folder = 'video_projects'
    elif choice == '4':
        project_type = 'idea'
        project_folder = 'other_projects'
    else:
        print("Invalid choice.")
        return

    project_name = input("Enter the project name: ")

    # Define the base path based on project type
    base_path = r"C:\Users\Tom\Proton Drive\eartquakepersimmon\My files\@projects"

    # Create the main folder
    main_folder_path = os.path.join(base_path, project_folder, project_name)
    os.makedirs(main_folder_path, exist_ok=True)

    # Create folders based on the project type
    if project_type == 'design':
        create_design_folders(main_folder_path, project_name)
    elif project_type == 'work':
        create_work_folders(main_folder_path, project_name)
    elif project_type == 'video':
        create_video_folders(main_folder_path, project_name)
    elif project_type == 'idea':
        create_idea_folders(main_folder_path, project_name)

    print("Folders created successfully.")

if __name__ == "__main__":
    create_project_folders()
